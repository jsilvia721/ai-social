/**
 * E2E test seed — creates deterministic fixtures for Playwright tests.
 * Idempotent: safe to run multiple times (uses upsert throughout).
 *
 * Run: npx tsx prisma/seed.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import pg from "pg";

const connectionString = process.env.DATABASE_URL!;
const sslDisabled = connectionString.includes("sslmode=disable");
const pool = new pg.Pool({
  connectionString,
  ...(sslDisabled ? {} : { ssl: { rejectUnauthorized: false } }),
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
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

  // Published post
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
    },
    update: { content: "This is a published post for E2E testing" },
  });

  console.log("Upserted 3 posts (DRAFT, SCHEDULED, PUBLISHED)");
  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
