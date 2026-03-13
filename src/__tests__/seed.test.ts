/**
 * Tests for prisma/seed.ts — verifies all E2E fixtures are created
 * with deterministic IDs and correct data.
 */
import { mockDeep, mockReset } from "jest-mock-extended";
import type { PrismaClient } from "@prisma/client";

import { seedDatabase } from "../../prisma/seed-logic";

// Create a deep mock of PrismaClient
const prismaMock = mockDeep<PrismaClient>();

beforeEach(() => mockReset(prismaMock));

// Configure default return values for chained upserts
function setupMockReturns() {
  const user = { id: "user-1", email: "test@example.com", name: "E2E Test User" };
  const business = { id: "e2e-business-1", name: "E2E Test Business" };
  const twitter = { id: "twitter-acc-1", platform: "TWITTER", platformId: "e2e-twitter-123" };
  const instagram = { id: "instagram-acc-1", platform: "INSTAGRAM", platformId: "e2e-ig-456" };

  prismaMock.user.upsert.mockResolvedValue(user as never);
  prismaMock.business.upsert.mockResolvedValue(business as never);
  prismaMock.businessMember.upsert.mockResolvedValue({} as never);
  prismaMock.socialAccount.upsert
    .mockResolvedValueOnce(twitter as never)
    .mockResolvedValueOnce(instagram as never);
  prismaMock.post.upsert.mockResolvedValue({} as never);
  prismaMock.contentStrategy.upsert.mockResolvedValue({} as never);
  prismaMock.contentBrief.upsert.mockResolvedValue({} as never);

  return { user, business, twitter, instagram };
}

describe("seed-logic", () => {
  it("creates a test user with test@example.com", async () => {
    setupMockReturns();
    await seedDatabase(prismaMock);

    expect(prismaMock.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "test@example.com" },
        create: expect.objectContaining({ email: "test@example.com" }),
      })
    );
  });

  it("creates a business with e2e-business-1 ID", async () => {
    setupMockReturns();
    await seedDatabase(prismaMock);

    expect(prismaMock.business.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "e2e-business-1" },
      })
    );
  });

  it("creates TWITTER and INSTAGRAM social accounts", async () => {
    setupMockReturns();
    await seedDatabase(prismaMock);

    expect(prismaMock.socialAccount.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.socialAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { platform_platformId: { platform: "TWITTER", platformId: "e2e-twitter-123" } },
      })
    );
    expect(prismaMock.socialAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { platform_platformId: { platform: "INSTAGRAM", platformId: "e2e-ig-456" } },
      })
    );
  });

  it("creates posts with all required statuses (DRAFT, SCHEDULED, PUBLISHED, PENDING_REVIEW)", async () => {
    setupMockReturns();
    await seedDatabase(prismaMock);

    const postCalls = prismaMock.post.upsert.mock.calls;

    // Should have 4 posts now
    expect(postCalls.length).toBe(4);

    const postIds = postCalls.map((call) => (call[0] as { where: { id: string } }).where.id);
    expect(postIds).toContain("e2e-post-draft-1");
    expect(postIds).toContain("e2e-post-scheduled-1");
    expect(postIds).toContain("e2e-post-published-1");
    expect(postIds).toContain("e2e-post-pending-review-1");

    // Verify PENDING_REVIEW post has correct status
    const pendingReviewCall = postCalls.find(
      (call) => (call[0] as { where: { id: string } }).where.id === "e2e-post-pending-review-1"
    );
    expect(pendingReviewCall).toBeDefined();
    expect((pendingReviewCall![0] as { create: { status: string } }).create.status).toBe(
      "PENDING_REVIEW"
    );
  });

  it("creates a ContentStrategy linked to e2e-business-1", async () => {
    setupMockReturns();
    await seedDatabase(prismaMock);

    expect(prismaMock.contentStrategy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: "e2e-business-1" },
        create: expect.objectContaining({
          id: expect.stringContaining("e2e-"),
          businessId: "e2e-business-1",
          contentPillars: expect.any(Array),
          targetAudience: expect.any(String),
          brandVoice: expect.any(String),
          industry: expect.any(String),
          optimizationGoal: expect.any(String),
        }),
      })
    );
  });

  it("creates 2 ContentBrief records (PENDING and FULFILLED)", async () => {
    setupMockReturns();
    await seedDatabase(prismaMock);

    expect(prismaMock.contentBrief.upsert).toHaveBeenCalledTimes(2);

    const briefCalls = prismaMock.contentBrief.upsert.mock.calls;
    const briefStatuses = briefCalls.map(
      (call) => (call[0] as { create: { status: string } }).create.status
    );
    expect(briefStatuses).toContain("PENDING");
    expect(briefStatuses).toContain("FULFILLED");

    // Both should have e2e- prefixed IDs
    const briefIds = briefCalls.map((call) => (call[0] as { where: { id: string } }).where.id);
    expect(briefIds.every((id) => id.startsWith("e2e-"))).toBe(true);
  });

  it("creates PostMetrics on the PUBLISHED post", async () => {
    setupMockReturns();
    await seedDatabase(prismaMock);

    // The published post upsert should include metrics fields
    const postCalls = prismaMock.post.upsert.mock.calls;
    const publishedCall = postCalls.find(
      (call) => (call[0] as { where: { id: string } }).where.id === "e2e-post-published-1"
    );
    expect(publishedCall).toBeDefined();

    const createData = (publishedCall![0] as { create: Record<string, unknown> }).create;
    expect(createData.metricsImpressions).toEqual(expect.any(Number));
    expect(createData.metricsLikes).toEqual(expect.any(Number));
    expect(createData.metricsComments).toEqual(expect.any(Number));
    expect(createData.metricsShares).toEqual(expect.any(Number));
    expect(createData.metricsUpdatedAt).toEqual(expect.any(Date));
  });

  it("uses deterministic e2e- prefixed IDs for all new records", async () => {
    setupMockReturns();
    await seedDatabase(prismaMock);

    // ContentStrategy
    const strategyCalls = prismaMock.contentStrategy.upsert.mock.calls;
    expect(
      (strategyCalls[0][0] as { create: { id: string } }).create.id.startsWith("e2e-")
    ).toBe(true);

    // ContentBriefs
    const briefCalls = prismaMock.contentBrief.upsert.mock.calls;
    for (const call of briefCalls) {
      expect((call[0] as { where: { id: string } }).where.id.startsWith("e2e-")).toBe(true);
    }

    // PENDING_REVIEW post
    const postCalls = prismaMock.post.upsert.mock.calls;
    const pendingReviewCall = postCalls.find(
      (call) => (call[0] as { create: { status: string } }).create.status === "PENDING_REVIEW"
    );
    expect(
      (pendingReviewCall![0] as { where: { id: string } }).where.id.startsWith("e2e-")
    ).toBe(true);
  });
});
