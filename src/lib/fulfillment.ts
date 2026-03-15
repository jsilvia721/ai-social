/**
 * Brief Fulfillment Engine — converts PENDING ContentBriefs into Posts.
 *
 * Called by:
 *   - src/cron/fulfill.ts (every 6h via EventBridge)
 *   - POST /api/fulfillment/run (on-demand trigger)
 */
import { prisma } from "@/lib/db";
import { generateImage } from "@/lib/media";
import { uploadBuffer } from "@/lib/storage";
import { sendFailureAlert } from "@/lib/alerts";
import { buildImagePrompt } from "@/lib/ai/prompts";
import { generateVideoStoryboard } from "@/lib/ai/index";
import { requiresMedia } from "@/lib/platform-rules";
import { getReplicateClient } from "@/lib/replicate-client";
import { processCompletedPrediction } from "@/lib/video";
import type { BriefFormat, ContentBrief, ContentStrategy, SocialAccount } from "@prisma/client";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FulfillmentResult {
  processed: number;
  created: number;
  skipped: number;
  failed: number;
}

export type ReviewDecision =
  | { status: "PENDING_REVIEW"; reviewWindowExpiresAt: Date }
  | { status: "PENDING_REVIEW"; reviewWindowExpiresAt: null }
  | { status: "SCHEDULED"; reason: "insufficient_review_time" | "no_review_configured" };

type FulfillableBrief = ContentBrief & {
  business: {
    contentStrategy: ContentStrategy | null;
    socialAccounts: SocialAccount[];
  };
};

// ── Constants ──────────────────────────────────────────────────────────────────

const LOOKAHEAD_MS = 48 * 60 * 60_000; // 48 hours
const STUCK_THRESHOLD_MS = 10 * 60_000; // 10 minutes
const RENDERING_STUCK_MS = 15 * 60_000; // 15 minutes
const WALL_CLOCK_BUDGET_MS = 4.5 * 60_000; // 4.5 minutes (Lambda timeout = 5 min)
const WALL_CLOCK_BUFFER_MS = 90_000; // reserve for one media gen + upload + tx
const MAX_RETRIES = 2;
const MIN_REVIEW_HOURS = 2; // minimum hours for review to be meaningful

// ── Review Decision ────────────────────────────────────────────────────────────

/**
 * Pure function — determines post status based on business review config.
 * Testable in isolation.
 */
export function computeReviewDecision(
  reviewWindowEnabled: boolean,
  reviewWindowHours: number,
  scheduledFor: Date,
  now: Date
): ReviewDecision {
  const hoursUntilScheduled = (scheduledFor.getTime() - now.getTime()) / (60 * 60_000);

  // If not enough time for any review, skip to SCHEDULED
  if (hoursUntilScheduled < MIN_REVIEW_HOURS) {
    return { status: "SCHEDULED", reason: "insufficient_review_time" };
  }

  if (reviewWindowEnabled) {
    // Immediate auto-publish mode — no review at all
    if (reviewWindowHours === 0) {
      return { status: "SCHEDULED", reason: "no_review_configured" };
    }
    // Auto-approve mode: if review window would exceed scheduledFor, skip review
    if (hoursUntilScheduled < reviewWindowHours) {
      return { status: "SCHEDULED", reason: "insufficient_review_time" };
    }
    return {
      status: "PENDING_REVIEW",
      reviewWindowExpiresAt: new Date(now.getTime() + reviewWindowHours * 60 * 60_000),
    };
  }

  // Explicit approval mode — no auto-approve
  return { status: "PENDING_REVIEW", reviewWindowExpiresAt: null };
}

// ── Format Handlers ────────────────────────────────────────────────────────────

/**
 * Exhaustive format dispatch — compile-time enforcement that all formats are handled.
 */
const formatHandlers = {
  TEXT: async () => null,
  IMAGE: async (prompt: string) => {
    const { buffer, mimeType } = await generateImage(prompt);
    return { buffer, mimeType };
  },
  CAROUSEL: async () => {
    console.warn("[fulfillment] CAROUSEL format not supported yet — skipping media");
    return null;
  },
  // VIDEO is handled separately in fulfillOneBrief via handleVideoStoryboard()
  VIDEO: async () => null,
} satisfies Record<BriefFormat, (prompt: string) => Promise<{ buffer: Buffer; mimeType: string } | null>>;

// ── Video Storyboard Handler ────────────────────────────────────────────────

/**
 * Handles VIDEO format: generates storyboard (script + thumbnail) and
 * transitions brief to STORYBOARD_REVIEW. No Post is created at this stage.
 */
async function handleVideoStoryboard(
  brief: FulfillableBrief,
  strategy: ContentStrategy
): Promise<void> {
  const storyboard = await generateVideoStoryboard(brief, strategy);
  const { buffer, mimeType } = await generateImage(storyboard.thumbnailPrompt);
  const ext = mimeType.split("/")[1] || "png";
  const thumbKey = `media/${brief.businessId}/${brief.id}-thumb.${ext}`;
  const thumbnailUrl = await uploadBuffer(buffer, thumbKey, mimeType);

  await prisma.contentBrief.update({
    where: { id: brief.id },
    data: {
      videoScript: storyboard.videoScript,
      videoPrompt: storyboard.videoPrompt,
      storyboardImageUrl: thumbnailUrl,
      status: "STORYBOARD_REVIEW",
    },
  });
}

// ── Rendering Reconciliation ────────────────────────────────────────────────

export interface ReconcileResult {
  reconciled: number;
  failed: number;
  skipped: number;
}

/**
 * Poll Replicate for RENDERING briefs stuck > 15 minutes.
 * Handles succeeded (process video), failed/canceled (mark FAILED),
 * and still-processing (leave alone).
 */
export async function reconcileStuckRendering(): Promise<ReconcileResult> {
  const stuckBefore = new Date(Date.now() - RENDERING_STUCK_MS);
  const briefs = await prisma.contentBrief.findMany({
    where: {
      status: "RENDERING",
      updatedAt: { lt: stuckBefore },
    },
    include: {
      business: {
        include: {
          contentStrategy: true,
          socialAccounts: true,
        },
      },
    },
  });

  const result: ReconcileResult = { reconciled: 0, failed: 0, skipped: 0 };

  for (const brief of briefs) {
    // No prediction ID — can't poll, mark failed
    if (!brief.replicatePredictionId) {
      await prisma.contentBrief.update({
        where: { id: brief.id },
        data: {
          status: "FAILED",
          errorMessage: "No Replicate prediction ID — cannot reconcile",
        },
      });
      result.failed++;
      continue;
    }

    let prediction: { status: string; output?: unknown; error?: unknown };
    try {
      prediction = await getReplicateClient().predictions.get(brief.replicatePredictionId);
    } catch (err) {
      // API error — skip this brief, try again next cycle
      console.error(`[fulfillment] Failed to reconcile brief ${brief.id}:`, err);
      result.skipped++;
      continue;
    }

    if (prediction.status === "succeeded") {
      // Extract output URL — same logic as webhook handler
      const rawOutput = prediction.output;
      const outputUrl = Array.isArray(rawOutput) ? rawOutput[0] : rawOutput;

      if (outputUrl && typeof outputUrl === "string") {
        // Atomic claim: RENDERING → FULFILLING (same pattern as webhook handler)
        const claimed = await prisma.contentBrief.updateMany({
          where: { id: brief.id, status: "RENDERING" },
          data: { status: "FULFILLING" },
        });
        if (claimed.count === 0) {
          result.skipped++; // webhook already processed it
          continue;
        }
        const processResult = await processCompletedPrediction(brief as FulfillableBrief, outputUrl);
        if (processResult.outcome === "created") {
          result.reconciled++;
        } else {
          result.failed++;
        }
      } else {
        await prisma.contentBrief.update({
          where: { id: brief.id },
          data: {
            status: "FAILED",
            errorMessage: "Prediction succeeded but no output URL",
          },
        });
        result.failed++;
      }
    } else if (
      prediction.status === "failed" ||
      prediction.status === "canceled"
    ) {
      const errorMsg = typeof prediction.error === "string"
        ? prediction.error
        : `Prediction ${prediction.status}`;
      await prisma.contentBrief.update({
        where: { id: brief.id },
        data: {
          status: "FAILED",
          errorMessage: errorMsg,
        },
      });
      result.failed++;
    } else {
      // Still starting or processing — leave alone
      result.skipped++;
    }
  }

  if (result.reconciled + result.failed > 0) {
    console.log(`[fulfillment] Rendering reconciliation: ${JSON.stringify(result)}`);
  }

  return result;
}

// ── Recovery ───────────────────────────────────────────────────────────────────

async function recoverStuckBriefs(): Promise<void> {
  const stuckBefore = new Date(Date.now() - STUCK_THRESHOLD_MS);
  await prisma.contentBrief.updateMany({
    where: {
      status: "FULFILLING",
      updatedAt: { lte: stuckBefore },
    },
    data: { status: "PENDING" },
    // retryCount and errorMessage are preserved — not overwritten
  });
}

// ── Pillar Matching ────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match topic against content pillars using word-boundary matching. */
export function matchPillar(topic: string, pillars: string[]): string | null {
  if (!topic || pillars.length === 0) return null;
  return (
    pillars.find((p) => {
      if (p.length < 2) return false; // skip single-char pillars to avoid false positives
      const regex = new RegExp(`\\b${escapeRegex(p)}\\b`, "i");
      return regex.test(topic);
    }) ?? null
  );
}

// ── Core Fulfillment ───────────────────────────────────────────────────────────

async function fulfillOneBrief(
  brief: FulfillableBrief,
  now: Date
): Promise<"created" | "skipped" | "failed"> {
  const strategy = brief.business.contentStrategy;
  if (!strategy) return "skipped";

  // Resolve socialAccountId for this brief's platform
  const account = brief.business.socialAccounts.find(
    (a) => a.platform === brief.platform
  );
  if (!account) {
    console.warn(
      `[fulfillment] No ${brief.platform} account for business ${brief.businessId} — skipping brief ${brief.id}`
    );
    return "skipped";
  }

  // Atomic claim: PENDING → FULFILLING (prevents double-processing)
  const claimed = await prisma.contentBrief.updateMany({
    where: { id: brief.id, status: "PENDING" },
    data: { status: "FULFILLING" },
  });
  if (claimed.count === 0) return "skipped"; // another invocation claimed it

  try {
    // Idempotency check: if a Post already exists for this brief (crash recovery)
    const existingPost = await prisma.post.findUnique({
      where: { briefId: brief.id },
    });
    if (existingPost) {
      // Link the brief if needed and mark fulfilled
      await prisma.contentBrief.update({
        where: { id: brief.id },
        data: { status: "FULFILLED", postId: existingPost.id },
      });
      return "skipped";
    }

    // VIDEO format: generate storyboard → STORYBOARD_REVIEW (no Post created)
    if (brief.recommendedFormat === "VIDEO") {
      await handleVideoStoryboard(brief, strategy);
      return "created"; // successfully processed
    }

    // Generate media based on format
    let mediaUrls: string[] = [];
    const handler = formatHandlers[brief.recommendedFormat];
    // Augment IMAGE prompts with Creative Profile context
    const basePrompt = brief.aiImagePrompt ?? brief.topic;
    const augmentedPrompt =
      brief.recommendedFormat === "IMAGE"
        ? buildImagePrompt(basePrompt, {
            accountType: strategy.accountType,
            visualStyle: strategy.visualStyle,
          })
        : basePrompt;
    const media = await handler(augmentedPrompt);
    if (media) {
      const key = `media/${brief.businessId}/${brief.id}.${media.mimeType.split("/")[1] || "png"}`;
      const url = await uploadBuffer(media.buffer, key, media.mimeType);
      mediaUrls = [url];
    }

    // Validate media for platforms that require it.
    // No retry — format mismatch is deterministic, not transient.
    if (!media && requiresMedia(brief.platform)) {
      const errorMessage = `${brief.platform} requires media but format ${brief.recommendedFormat} produced none`;
      console.error(`[fulfillment] BRIEF_FAILED briefId=${brief.id} businessId=${brief.businessId} error=${errorMessage}`);
      await prisma.contentBrief.update({
        where: { id: brief.id },
        data: { status: "FAILED", errorMessage },
      });
      return "failed";
    }

    // Compute review decision
    const decision = computeReviewDecision(
      strategy.reviewWindowEnabled,
      strategy.reviewWindowHours,
      brief.scheduledFor,
      now
    );

    // Create Post + update Brief in interactive transaction
    await prisma.$transaction(async (tx) => {
      const post = await tx.post.create({
        data: {
          businessId: brief.businessId,
          socialAccountId: account.id,
          content: brief.suggestedCaption,
          mediaUrls,
          status: decision.status,
          scheduledAt: brief.scheduledFor,
          briefId: brief.id,
          reviewWindowExpiresAt:
            decision.status === "PENDING_REVIEW" ? decision.reviewWindowExpiresAt : null,
          topicPillar: matchPillar(brief.topic, strategy.contentPillars),
        },
      });
      await tx.contentBrief.update({
        where: { id: brief.id },
        data: { status: "FULFILLED", postId: post.id },
      });
    });

    return "created";
  } catch (err) {
    // Retry logic
    const newRetryCount = brief.retryCount + 1;
    const errorMessage = err instanceof Error ? err.message : String(err);

    try {
      if (newRetryCount > MAX_RETRIES) {
        await prisma.contentBrief.update({
          where: { id: brief.id },
          data: { status: "FAILED", retryCount: newRetryCount, errorMessage },
        });
        // Structured log for CloudWatch alarm detection
        console.error(`[fulfillment] BRIEF_FAILED briefId=${brief.id} businessId=${brief.businessId} retries=${MAX_RETRIES} error=${errorMessage}`);
        // SES alert to business owner
        const owner = await prisma.businessMember.findFirst({
          where: { businessId: brief.businessId, role: "OWNER" },
          include: { user: true },
        });
        if (owner) {
          await sendFailureAlert(
            owner.user.email,
            `[AI Social] Content brief failed after ${MAX_RETRIES + 1} attempts`,
            [
              `Brief ID: ${brief.id}`,
              `Topic: ${brief.topic}`,
              `Platform: ${brief.platform}`,
              `Error: ${errorMessage}`,
              ``,
              `The AI fulfillment engine was unable to generate this content. You may want to manually create this post or adjust the brief.`,
            ].join("\n"),
          );
        }
      } else {
        // Revert to PENDING for retry in next cycle
        await prisma.contentBrief.update({
          where: { id: brief.id },
          data: { status: "PENDING", retryCount: newRetryCount, errorMessage },
        });
      }
    } catch (revertErr) {
      // If even the revert fails, log both errors
      console.error(`[fulfillment] Failed to revert brief ${brief.id}:`, revertErr);
      console.error(`[fulfillment] Original error:`, err);
    }
    return "failed";
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function runFulfillment(businessId?: string): Promise<FulfillmentResult> {
  const deadline = Date.now() + WALL_CLOCK_BUDGET_MS;
  const now = new Date();
  const lookaheadEnd = new Date(now.getTime() + LOOKAHEAD_MS);

  // Step 0a: Reconcile stuck RENDERING briefs (> 15 min) — poll Replicate
  await reconcileStuckRendering();

  // Step 0b: Recover stuck FULFILLING briefs (> 10 min)
  await recoverStuckBriefs();

  // Step 1: Query PENDING briefs within 48h window
  const briefs = await prisma.contentBrief.findMany({
    where: {
      status: "PENDING",
      scheduledFor: { lte: lookaheadEnd },
      ...(businessId && { businessId }),
    },
    orderBy: [{ sortOrder: "asc" }, { scheduledFor: "asc" }],
    include: {
      business: {
        include: {
          contentStrategy: true,
          socialAccounts: true,
        },
      },
    },
  });

  const result: FulfillmentResult = {
    processed: 0,
    created: 0,
    skipped: 0,
    failed: 0,
  };

  // Step 2: Fulfill each brief (check wall-clock budget before each)
  for (const brief of briefs) {
    // Wall-clock budget check BEFORE media generation
    if (Date.now() > deadline - WALL_CLOCK_BUFFER_MS) {
      console.warn(`[fulfillment] Wall-clock budget exceeded — stopping early`);
      break;
    }

    const outcome = await fulfillOneBrief(brief as FulfillableBrief, now);
    result.processed++;
    result[outcome]++;
  }

  return result;
}
