/**
 * Brief Generation Pipeline — invoked by AWS EventBridge Lambda every Sunday 23:00 UTC.
 *
 * For each active workspace with a ContentStrategy + connected SocialAccounts:
 *   1. Expire PENDING briefs from previous weeks
 *   2. Gather latest research themes + recent post topics
 *   3. Call Claude to generate platform-specific content briefs
 *   4. Store ContentBrief records for the upcoming week
 *   5. Send email digest to workspace owner
 */
import { prisma } from "@/lib/db";
import { generateBriefs } from "@/lib/ai/briefs";
import { sendBriefDigest } from "@/lib/notifications";

// ── Types ────────────────────────────────────────────────────────────────────

interface PostingCadence {
  [platform: string]: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CADENCE_PER_PLATFORM = 3;
const WALL_CLOCK_BUFFER_MS = 30_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get the Monday 00:00 UTC of the next week from a given date */
function getNextMonday(from: Date): Date {
  const d = new Date(from);
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Parse "MONDAY 10:00" into a Date relative to the given Monday */
function parseSuggestedDay(suggestedDay: string, weekOfMonday: Date): Date {
  const dayMap: Record<string, number> = {
    MONDAY: 0,
    TUESDAY: 1,
    WEDNESDAY: 2,
    THURSDAY: 3,
    FRIDAY: 4,
    SATURDAY: 5,
    SUNDAY: 6,
  };

  const parts = suggestedDay.trim().split(/\s+/);
  const dayName = parts[0]?.toUpperCase() ?? "MONDAY";
  const timePart = parts[1] ?? "10:00";
  const [hours, minutes] = timePart.split(":").map(Number);

  const dayOffset = dayMap[dayName] ?? 0;
  const result = new Date(weekOfMonday);
  result.setUTCDate(result.getUTCDate() + dayOffset);
  result.setUTCHours(hours || 10, minutes || 0, 0, 0);
  return result;
}

// ── Main pipeline ────────────────────────────────────────────────────────────

export async function runBriefGeneration(
  deadlineMs?: number
): Promise<{ processed: number; briefsCreated: number }> {
  const deadline = deadlineMs ?? Date.now() + 4.5 * 60_000;

  // Fetch workspaces with strategy + connected accounts
  const workspaces = await prisma.business.findMany({
    where: {
      contentStrategy: { isNot: null },
      socialAccounts: { some: {} },
    },
    include: {
      contentStrategy: true,
      socialAccounts: { select: { platform: true } },
      members: {
        where: { role: "OWNER" },
        include: { user: { select: { email: true } } },
      },
    },
  });

  let processed = 0;
  let briefsCreated = 0;
  const weekOf = getNextMonday(new Date());

  for (const workspace of workspaces) {
    if (Date.now() > deadline - WALL_CLOCK_BUFFER_MS) {
      console.warn(`Brief generation: bailing early, ${workspaces.length - processed} workspaces remaining`);
      break;
    }

    const strategy = workspace.contentStrategy;
    if (!strategy) continue;

    try {
      // 1. Expire PENDING briefs from previous weeks
      await prisma.contentBrief.updateMany({
        where: {
          businessId: workspace.id,
          status: "PENDING",
          weekOf: { lt: weekOf },
        },
        data: { status: "EXPIRED" },
      });

      // 2. Gather latest research themes
      const latestResearch = await prisma.researchSummary.findFirst({
        where: { businessId: workspace.id },
        orderBy: { createdAt: "desc" },
      });

      const researchThemes = latestResearch?.synthesizedThemes ?? "No recent research available.";

      // 3. Get recent post topics to avoid repetition
      const recentPosts = await prisma.post.findMany({
        where: { businessId: workspace.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { content: true },
      });
      const recentPostTopics = recentPosts.map((p) => p.content.slice(0, 100));

      // 4. Build cadence per platform
      const connectedPlatforms = [...new Set(workspace.socialAccounts.map((a) => a.platform))];
      const cadenceConfig = (strategy.postingCadence as PostingCadence) ?? {};
      const cadencePerPlatform: Record<string, number> = {};
      for (const platform of connectedPlatforms) {
        cadencePerPlatform[platform] = cadenceConfig[platform] ?? DEFAULT_CADENCE_PER_PLATFORM;
      }

      // 5. Call Claude to generate briefs (pass learned format mix if available)
      const formatMix = strategy.formatMix as Record<string, number> | null;
      const result = await generateBriefs(
        strategy.industry,
        strategy.targetAudience,
        strategy.contentPillars,
        strategy.brandVoice,
        connectedPlatforms,
        cadencePerPlatform,
        researchThemes,
        recentPostTopics,
        formatMix,
      );

      // 6. Store ContentBrief records
      const createdBriefs = [];
      for (let i = 0; i < result.briefs.length; i++) {
        const brief = result.briefs[i];
        const scheduledFor = parseSuggestedDay(brief.suggestedDay, weekOf);

        const created = await prisma.contentBrief.create({
          data: {
            businessId: workspace.id,
            researchSummaryId: latestResearch?.id,
            topic: brief.topic,
            rationale: brief.rationale,
            suggestedCaption: brief.suggestedCaption,
            aiImagePrompt: brief.aiImagePrompt ?? null,
            contentGuidance: brief.contentGuidance ?? null,
            recommendedFormat: brief.recommendedFormat,
            platform: brief.platform,
            scheduledFor,
            weekOf,
            sortOrder: i,
          },
        });
        createdBriefs.push(created);
      }

      briefsCreated += createdBriefs.length;
      processed++;

      // 7. Send email digest (best-effort)
      const owner = workspace.members[0];
      if (owner) {
        await sendBriefDigest(
          owner.user.email,
          workspace.name,
          createdBriefs
        ).catch((err) => {
          console.error(`Failed to send brief digest for workspace ${workspace.id}:`, err);
        });
      }
    } catch (err) {
      console.error(`Brief generation failed for workspace ${workspace.id}:`, err);
    }
  }

  return { processed, briefsCreated };
}
