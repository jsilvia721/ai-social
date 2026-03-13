/**
 * Seed logic extracted for testability.
 * Used by seed.ts (with real Prisma) and tests (with mock Prisma).
 */
import type { PrismaClient } from "@prisma/client";

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  // ── Test user ──────────────────────────────────────────────────────────────
  const user = await prisma.user.upsert({
    where: { email: "test@example.com" },
    create: { email: "test@example.com", name: "E2E Test User" },
    update: { name: "E2E Test User" },
  });

  console.log(`Upserted user: ${user.id} (${user.email})`);

  // ── Business ───────────────────────────────────────────────────────────────
  const business = await prisma.business.upsert({
    where: { id: "e2e-business-1" },
    create: { id: "e2e-business-1", name: "E2E Test Business" },
    update: { name: "E2E Test Business" },
  });

  // ── Business membership ────────────────────────────────────────────────────
  await prisma.businessMember.upsert({
    where: { businessId_userId: { businessId: business.id, userId: user.id } },
    create: { businessId: business.id, userId: user.id, role: "OWNER" },
    update: { role: "OWNER" },
  });

  console.log(`Upserted business: ${business.id} (${business.name})`);

  // ── Social accounts ────────────────────────────────────────────────────────
  const twitter = await prisma.socialAccount.upsert({
    where: { platform_platformId: { platform: "TWITTER", platformId: "e2e-twitter-123" } },
    create: {
      businessId: business.id,
      platform: "TWITTER",
      platformId: "e2e-twitter-123",
      username: "e2etestuser",
      blotatoAccountId: "blotato-twitter-e2e",
    },
    update: { username: "e2etestuser" },
  });

  const instagram = await prisma.socialAccount.upsert({
    where: { platform_platformId: { platform: "INSTAGRAM", platformId: "e2e-ig-456" } },
    create: {
      businessId: business.id,
      platform: "INSTAGRAM",
      platformId: "e2e-ig-456",
      username: "e2etestuser_ig",
      blotatoAccountId: "blotato-ig-e2e",
    },
    update: { username: "e2etestuser_ig" },
  });

  console.log(`Upserted accounts: TWITTER(${twitter.id}), INSTAGRAM(${instagram.id})`);

  // ── Posts ──────────────────────────────────────────────────────────────────
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Draft post
  await prisma.post.upsert({
    where: { id: "e2e-post-draft-1" },
    create: {
      id: "e2e-post-draft-1",
      businessId: business.id,
      socialAccountId: twitter.id,
      content: "This is a draft post for E2E testing",
      status: "DRAFT",
      mediaUrls: [],
    },
    update: { content: "This is a draft post for E2E testing" },
  });

  // Scheduled post
  await prisma.post.upsert({
    where: { id: "e2e-post-scheduled-1" },
    create: {
      id: "e2e-post-scheduled-1",
      businessId: business.id,
      socialAccountId: twitter.id,
      content: "This is a scheduled post for E2E testing",
      status: "SCHEDULED",
      scheduledAt: tomorrow,
      mediaUrls: [],
    },
    update: { content: "This is a scheduled post for E2E testing", scheduledAt: tomorrow },
  });

  // Published post (with metrics for analytics pages)
  await prisma.post.upsert({
    where: { id: "e2e-post-published-1" },
    create: {
      id: "e2e-post-published-1",
      businessId: business.id,
      socialAccountId: instagram.id,
      content: "This is a published post for E2E testing",
      status: "PUBLISHED",
      scheduledAt: yesterday,
      publishedAt: yesterday,
      blotatoPostId: "blotato-post-abc123",
      mediaUrls: [],
      metricsImpressions: 1250,
      metricsLikes: 87,
      metricsComments: 14,
      metricsShares: 23,
      metricsReach: 980,
      metricsSaves: 9,
      metricsUpdatedAt: yesterday,
    },
    update: {
      content: "This is a published post for E2E testing",
      metricsImpressions: 1250,
      metricsLikes: 87,
      metricsComments: 14,
      metricsShares: 23,
      metricsReach: 980,
      metricsSaves: 9,
      metricsUpdatedAt: yesterday,
    },
  });

  // Pending review post (for /dashboard/review page)
  await prisma.post.upsert({
    where: { id: "e2e-post-pending-review-1" },
    create: {
      id: "e2e-post-pending-review-1",
      businessId: business.id,
      socialAccountId: twitter.id,
      content:
        "AI-generated post awaiting review: 5 productivity tips every startup founder needs to know 🚀",
      status: "PENDING_REVIEW",
      scheduledAt: tomorrow,
      reviewWindowExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      mediaUrls: [],
    },
    update: {
      content:
        "AI-generated post awaiting review: 5 productivity tips every startup founder needs to know 🚀",
      status: "PENDING_REVIEW",
    },
  });

  console.log("Upserted 4 posts (DRAFT, SCHEDULED, PUBLISHED, PENDING_REVIEW)");

  // ── Content Strategy ───────────────────────────────────────────────────────
  await prisma.contentStrategy.upsert({
    where: { businessId: "e2e-business-1" },
    create: {
      id: "e2e-content-strategy-1",
      businessId: "e2e-business-1",
      industry: "Technology / SaaS",
      targetAudience:
        "Startup founders, indie hackers, and small business owners aged 25-45 interested in productivity and growth",
      contentPillars: [
        "Startup Growth",
        "Productivity Tips",
        "Tech Industry Trends",
        "Founder Stories",
      ],
      brandVoice:
        "Conversational and approachable with a confident, knowledgeable tone. Uses clear language, avoids jargon, and mixes data-driven insights with relatable anecdotes. Occasionally humorous but always professional.",
      optimizationGoal: "engagement",
      reviewWindowEnabled: true,
      reviewWindowHours: 24,
      postingCadence: { TWITTER: 5, INSTAGRAM: 3 },
      formatMix: { TEXT: 0.4, IMAGE: 0.4, VIDEO: 0.2 },
      accountType: "BUSINESS",
    },
    update: {
      industry: "Technology / SaaS",
      targetAudience:
        "Startup founders, indie hackers, and small business owners aged 25-45 interested in productivity and growth",
    },
  });

  console.log("Upserted content strategy for e2e-business-1");

  // ── Content Briefs ─────────────────────────────────────────────────────────
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const weekOf = new Date(nextWeek);
  weekOf.setDate(weekOf.getDate() - weekOf.getDay()); // Start of week (Sunday)

  // Fulfilled brief (linked to published post)
  await prisma.contentBrief.upsert({
    where: { id: "e2e-brief-fulfilled-1" },
    create: {
      id: "e2e-brief-fulfilled-1",
      businessId: "e2e-business-1",
      topic: "5 Productivity Hacks for Remote Startup Teams",
      rationale:
        "Remote work productivity is a trending topic with high engagement. Aligns with the Productivity Tips pillar and resonates with our target audience of startup founders.",
      suggestedCaption:
        "Remote team productivity doesn't have to be hard. Here are 5 battle-tested strategies from founders who've built distributed teams from day one. 🧵",
      recommendedFormat: "TEXT",
      platform: "TWITTER",
      scheduledFor: yesterday,
      status: "FULFILLED",
      weekOf,
      sortOrder: 1,
    },
    update: {
      topic: "5 Productivity Hacks for Remote Startup Teams",
      status: "FULFILLED",
    },
  });

  // Pending brief (awaiting fulfillment)
  await prisma.contentBrief.upsert({
    where: { id: "e2e-brief-pending-1" },
    create: {
      id: "e2e-brief-pending-1",
      businessId: "e2e-business-1",
      topic: "Why Most SaaS Startups Fail at Content Marketing",
      rationale:
        "Content marketing failure is a common pain point. Strong hook potential for engagement and discussion. Maps to Startup Growth pillar.",
      suggestedCaption:
        "90% of SaaS startups get content marketing wrong. Here's what the top 10% do differently (and it's not what you think).",
      contentGuidance:
        "Focus on actionable takeaways. Include at least one surprising statistic. End with a question to drive comments.",
      recommendedFormat: "IMAGE",
      platform: "INSTAGRAM",
      scheduledFor: nextWeek,
      status: "PENDING",
      weekOf,
      sortOrder: 2,
    },
    update: {
      topic: "Why Most SaaS Startups Fail at Content Marketing",
      status: "PENDING",
    },
  });

  console.log("Upserted 2 content briefs (FULFILLED, PENDING)");
  console.log("Seed complete.");
}
