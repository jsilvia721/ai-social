/**
 * Video generation constants and post-processing.
 *
 * Constants: VIDEO_MODEL_DEFAULT, PLATFORM_VIDEO_ASPECT_RATIO, VIDEO_DURATION_DEFAULT.
 * Processing: processCompletedPrediction() downloads video from Replicate, uploads to S3,
 * creates Post with review decision, marks brief FULFILLED.
 */

import type { ContentBrief, ContentStrategy, Platform, SocialAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { downloadAndUploadVideo } from "@/lib/media";
import { computeReviewDecision, matchPillar } from "@/lib/fulfillment";
import { reportServerError } from "@/lib/server-error-reporter";

// ── Video Generation Constants ──────────────────────────────────────────────

/** Default Replicate model for video generation (Kling V3 Omni). */
export const VIDEO_MODEL_DEFAULT = "kwaivgi/kling-v3-omni-video";

/** Default video duration in seconds. */
export const VIDEO_DURATION_DEFAULT = 5;

/** Max prompt length for Kling V3. */
export const VIDEO_PROMPT_MAX_LENGTH = 2500;

/**
 * Platform-specific aspect ratios for video content.
 * Vertical (9:16) for short-form, horizontal (16:9) for long-form.
 */
export const PLATFORM_VIDEO_ASPECT_RATIO: Record<Platform, string> = {
  TIKTOK: "9:16",
  INSTAGRAM: "9:16",
  YOUTUBE: "16:9",
  FACEBOOK: "16:9",
  TWITTER: "16:9",
};

// ── Types ──────────────────────────────────────────────────────────────────────

export type BriefWithRelations = ContentBrief & {
  business: {
    contentStrategy: ContentStrategy | null;
    socialAccounts: SocialAccount[];
  };
};

export interface ProcessResult {
  outcome: "created" | "skipped" | "failed";
  postId?: string;
  error?: string;
}

// ── Core Processing ────────────────────────────────────────────────────────────

/**
 * Process a completed Replicate prediction: download video, upload to S3,
 * create Post, mark brief FULFILLED.
 *
 * Shared between webhook handler and reconciliation cron.
 *
 * @param brief       — the ContentBrief with business relations
 * @param outputUrl   — the Replicate prediction output URL (video file)
 */
export async function processCompletedPrediction(
  brief: BriefWithRelations,
  outputUrl: string
): Promise<ProcessResult> {
  const strategy = brief.business.contentStrategy;
  if (!strategy) {
    return { outcome: "skipped", error: "No content strategy configured" };
  }

  // Resolve social account for this brief's platform
  const account = brief.business.socialAccounts.find(
    (a) => a.platform === brief.platform
  );
  if (!account) {
    return {
      outcome: "skipped",
      error: `No ${brief.platform} account for business ${brief.businessId}`,
    };
  }

  try {
    // Download video from Replicate and stream-upload to S3
    const s3Key = `media/${brief.businessId}/${brief.id}.mp4`;
    const videoUrl = await downloadAndUploadVideo(outputUrl, s3Key);

    // Compute review decision
    const now = new Date();
    const decision = computeReviewDecision(
      strategy.reviewWindowEnabled,
      strategy.reviewWindowHours,
      brief.scheduledFor,
      now
    );

    // Create Post + update Brief atomically
    const post = await prisma.$transaction(async (tx) => {
      const created = await tx.post.create({
        data: {
          businessId: brief.businessId,
          socialAccountId: account.id,
          content: brief.suggestedCaption,
          mediaUrls: [videoUrl],
          coverImageUrl: brief.storyboardImageUrl ?? null,
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
        data: { status: "FULFILLED", postId: created.id },
      });
      return created;
    });

    return { outcome: "created", postId: post.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await reportServerError("Video processing failed", {
      url: "/api/webhooks/replicate",
      metadata: { briefId: brief.id, businessId: brief.businessId, outputUrl },
    });

    // Mark brief as FAILED
    try {
      await prisma.contentBrief.update({
        where: { id: brief.id },
        data: { status: "FAILED", errorMessage },
      });
    } catch (updateErr) {
      console.error(`[video] Failed to mark brief ${brief.id} as FAILED:`, updateErr);
    }

    return { outcome: "failed", error: errorMessage };
  }
}
