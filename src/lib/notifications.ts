/**
 * Notification helpers — SES email for brief digests and review alerts.
 * Best-effort: failures are caught and logged, never block pipelines.
 */
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { prisma } from "@/lib/db";
import { env } from "@/env";

interface BriefSummary {
  topic: string;
  platform: string;
  recommendedFormat: string;
  suggestedCaption: string;
  scheduledFor: Date;
}

export async function sendBriefDigest(
  toEmail: string,
  businessName: string,
  briefs: BriefSummary[]
): Promise<void> {
  if (!env.SES_FROM_EMAIL) return;

  const briefLines = briefs.map(
    (b) =>
      `• [${b.platform}] ${b.topic} (${b.recommendedFormat})\n` +
      `  Caption: ${b.suggestedCaption.slice(0, 120)}${b.suggestedCaption.length > 120 ? "..." : ""}\n` +
      `  Scheduled: ${b.scheduledFor.toUTCString()}`
  );

  const ses = new SESClient({ region: "us-east-1" });
  await ses.send(
    new SendEmailCommand({
      Source: env.SES_FROM_EMAIL,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: {
          Data: `[AI Social] ${briefs.length} new content briefs for ${businessName}`,
        },
        Body: {
          Text: {
            Data: [
              `Hi! Your content briefs for ${businessName} are ready.`,
              ``,
              `${briefs.length} briefs generated:`,
              ``,
              ...briefLines,
              ``,
              `Log in to your dashboard to review and fulfill these briefs.`,
            ].join("\n"),
          },
        },
      },
    })
  );
}

// ── Review Notifications ──────────────────────────────────────────────────────

/**
 * Query PENDING_REVIEW posts created in the last 30 minutes and email
 * each business owner a summary. Called after fulfillment runs.
 *
 * Best-effort — catches all errors so the cron never fails on notifications.
 */
export async function sendReviewNotifications(): Promise<void> {
  try {
    if (!env.SES_FROM_EMAIL) return;

    const since = new Date(Date.now() - 30 * 60_000);
    const posts = await prisma.post.findMany({
      where: {
        status: "PENDING_REVIEW",
        createdAt: { gte: since },
      },
      select: {
        id: true,
        businessId: true,
        content: true,
        scheduledAt: true,
        socialAccount: { select: { platform: true, username: true } },
        business: {
          select: {
            name: true,
            members: {
              where: { role: "OWNER" },
              select: { user: { select: { email: true } } },
            },
          },
        },
      },
    });

    if (posts.length === 0) return;

    // Group by businessId
    const byBusiness = new Map<string, typeof posts>();
    for (const post of posts) {
      const group = byBusiness.get(post.businessId) ?? [];
      group.push(post);
      byBusiness.set(post.businessId, group);
    }

    const ses = new SESClient({ region: "us-east-1" });

    for (const [, bizPosts] of byBusiness) {
      const biz = bizPosts[0].business;
      const owner = biz.members[0];
      if (!owner) continue;

      const postLines = bizPosts.map(
        (p) =>
          `• [${p.socialAccount.platform}] @${p.socialAccount.username}\n` +
          `  ${p.content.slice(0, 120)}${p.content.length > 120 ? "..." : ""}\n` +
          (p.scheduledAt ? `  Scheduled: ${p.scheduledAt.toUTCString()}` : "")
      );

      await ses.send(
        new SendEmailCommand({
          Source: env.SES_FROM_EMAIL,
          Destination: { ToAddresses: [owner.user.email] },
          Message: {
            Subject: {
              Data: `[AI Social] ${bizPosts.length} post${bizPosts.length !== 1 ? "s" : ""} ready for review — ${biz.name}`,
            },
            Body: {
              Text: {
                Data: [
                  `Hi! The AI has generated ${bizPosts.length} new post${bizPosts.length !== 1 ? "s" : ""} for ${biz.name}.`,
                  ``,
                  `Posts awaiting your review:`,
                  ``,
                  ...postLines,
                  ``,
                  `Review and approve them in your dashboard:`,
                  `${env.NEXTAUTH_URL}/dashboard/review`,
                ].join("\n"),
              },
            },
          },
        })
      );
    }
  } catch (err) {
    console.error("[notifications] Failed to send review notifications:", err);
  }
}
