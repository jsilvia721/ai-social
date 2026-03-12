import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/blotato/publish");
jest.mock("@/lib/alerts");

import { runScheduler, runMetricsRefresh } from "@/lib/scheduler";
import { publishPost } from "@/lib/blotato/publish";
import { sendFailureAlert } from "@/lib/alerts";

const mockPublishPost = publishPost as jest.MockedFunction<typeof publishPost>;
const mockSendFailureAlert = sendFailureAlert as jest.MockedFunction<typeof sendFailureAlert>;

// Shared test data
const mockSocialAccount = {
  id: "sa-1",
  businessId: "biz-1",
  platform: "TWITTER" as const,
  platformId: "tw-123",
  username: "@acme",
  blotatoAccountId: "blotato-acct-1",
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockOwnerUser = {
  id: "user-1",
  email: "owner@example.com",
  emailVerified: null,
  name: "Owner",
  image: null,
  activeBusinessId: "biz-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockOwnerMember = {
  id: "mem-1",
  businessId: "biz-1",
  userId: "user-1",
  role: "OWNER" as const,
  joinedAt: new Date(),
  user: mockOwnerUser,
};

const mockBusiness = {
  id: "biz-1",
  name: "Acme Corp",
  createdAt: new Date(),
  updatedAt: new Date(),
  members: [mockOwnerMember],
};

function makePost(overrides?: Partial<{
  id: string;
  status: string;
  retryCount: number;
  retryAt: Date | null;
  scheduledAt: Date | null;
  errorMessage: string | null;
}>) {
  const now = new Date();
  return {
    id: "post-1",
    businessId: "biz-1",
    socialAccountId: "sa-1",
    content: "Hello world",
    mediaUrls: [],
    status: "SCHEDULED",
    retryCount: 0,
    retryAt: null,
    scheduledAt: new Date(now.getTime() - 60_000), // 1 min ago
    publishedAt: null,
    reviewWindowExpiresAt: null,
    blotatoPostId: null,
    errorMessage: null,
    metricsLikes: null,
    metricsComments: null,
    metricsShares: null,
    metricsImpressions: null,
    metricsReach: null,
    metricsSaves: null,
    metricsUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
    socialAccount: mockSocialAccount,
    business: mockBusiness,
    ...overrides,
  };
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();

  // Default: alert utility succeeds
  mockSendFailureAlert.mockResolvedValue(undefined);
});

// ── runScheduler ──────────────────────────────────────────────────────────────

describe("runScheduler", () => {
  it("does nothing when no due posts exist", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);
    prismaMock.post.updateMany.mockResolvedValue({ count: 0 });

    const result = await runScheduler();

    expect(result.processed).toBe(0);
    // Stuck-post recovery always fires but should not publish anything
    expect(mockPublishPost).not.toHaveBeenCalled();
    // No per-post atomic claim should be made
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it("publishes a due SCHEDULED post and marks it PUBLISHED", async () => {
    const post = makePost({ status: "SCHEDULED" });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    // Atomic claim succeeds (count: 1)
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    mockPublishPost.mockResolvedValue({ blotatoPostId: "blotato-post-abc" });
    prismaMock.post.update.mockResolvedValue(post as any);

    const result = await runScheduler();

    expect(result.processed).toBe(1);
    expect(prismaMock.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "post-1", status: { in: ["SCHEDULED", "RETRYING"] } },
        data: { status: "PUBLISHING" },
      })
    );
    expect(mockPublishPost).toHaveBeenCalledWith(
      "blotato-acct-1",
      "Hello world",
      "TWITTER",
      []
    );
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "post-1" },
        data: expect.objectContaining({
          status: "PUBLISHED",
          blotatoPostId: "blotato-post-abc",
          retryCount: 0,
          retryAt: null,
        }),
      })
    );
  });

  it("picks up RETRYING posts whose retryAt has passed", async () => {
    const post = makePost({
      status: "RETRYING",
      retryCount: 1,
      retryAt: new Date(Date.now() - 1000), // already past
    });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    mockPublishPost.mockResolvedValue({ blotatoPostId: "blotato-post-xyz" });
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ status: "RETRYING" }),
          ]),
        }),
      })
    );
    expect(mockPublishPost).toHaveBeenCalled();
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PUBLISHED" }),
      })
    );
  });

  it("skips a post when atomic claim returns count=0 (another invocation won the race)", async () => {
    const post = makePost({ status: "SCHEDULED" });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    // Claim fails — another lambda claimed it first
    prismaMock.post.updateMany.mockResolvedValue({ count: 0 });

    await runScheduler();

    expect(mockPublishPost).not.toHaveBeenCalled();
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it("sets post to RETRYING with jitter delay on first publish failure", async () => {
    const post = makePost({ status: "SCHEDULED", retryCount: 0 });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    mockPublishPost.mockRejectedValue(new Error("Network error"));
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "post-1" },
        data: expect.objectContaining({
          status: "RETRYING",
          retryCount: 1,
          retryAt: expect.any(Date),
          errorMessage: "Network error",
        }),
      })
    );
    // Should NOT send SES alert on first failure
    expect(mockSendFailureAlert).not.toHaveBeenCalled();
  });

  it("sets post to RETRYING on second failure", async () => {
    const post = makePost({ status: "RETRYING", retryCount: 1 });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    mockPublishPost.mockRejectedValue(new Error("Timeout"));
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RETRYING", retryCount: 2 }),
      })
    );
    expect(mockSendFailureAlert).not.toHaveBeenCalled();
  });

  it("sets post to FAILED and sends SES alert on third failure", async () => {
    const post = makePost({ status: "RETRYING", retryCount: 2 });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    mockPublishPost.mockRejectedValue(new Error("Blotato down"));
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: "Blotato down",
        }),
      })
    );
    // SES alert should be sent
    expect(mockSendFailureAlert).toHaveBeenCalledWith(
      "owner@example.com",
      expect.stringContaining("Post failed to publish"),
      expect.stringContaining("post-1"),
    );
  });

  it("does NOT retry on 4xx non-429 errors (client errors are permanent)", async () => {
    const { BlotatoApiError } = await import("@/lib/blotato/client");
    const post = makePost({ status: "SCHEDULED", retryCount: 0 });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    mockPublishPost.mockRejectedValue(new BlotatoApiError("Invalid account", 404));
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    // Should go straight to FAILED, skip retry
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });

  it("retries on 429 rate limit errors", async () => {
    const { BlotatoRateLimitError } = await import("@/lib/blotato/client");
    const post = makePost({ status: "SCHEDULED", retryCount: 0 });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    mockPublishPost.mockRejectedValue(new BlotatoRateLimitError(60_000));
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RETRYING", retryCount: 1 }),
      })
    );
  });

  it("recovers stuck PUBLISHING posts (older than 5 min) by resetting to RETRYING", async () => {
    // First findMany: no due posts; stuck-post recovery still runs via updateMany
    prismaMock.post.findMany.mockResolvedValueOnce([]);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 }); // stuck post recovery

    await runScheduler();

    // Stuck post recovery should call updateMany to reset PUBLISHING → RETRYING
    expect(prismaMock.post.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "PUBLISHING",
          updatedAt: expect.objectContaining({ lte: expect.any(Date) }),
        }),
        data: expect.objectContaining({ status: "RETRYING" }),
      })
    );
  });
});

// ── runMetricsRefresh ────────────────────────────────────────────────────────

describe("runMetricsRefresh", () => {
  it("returns 0 processed when no published posts need refresh", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    const result = await runMetricsRefresh();

    expect(result.processed).toBe(0);
  });

  it("fetches metrics and updates DB for each published post", async () => {
    const publishedPost = {
      ...makePost({ status: "PUBLISHED" }),
      blotatoPostId: "blotato-post-abc",
    };
    prismaMock.post.findMany.mockResolvedValue([publishedPost] as any);

    const mockMetrics = {
      likes: 42,
      comments: 5,
      shares: 10,
      impressions: 1000,
      reach: 800,
      saves: 3,
    };

    // Spy on global.fetch for the Blotato metrics call
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => mockMetrics,
    } as Response);

    prismaMock.post.update.mockResolvedValue(publishedPost as any);

    const result = await runMetricsRefresh();

    expect(result.processed).toBe(1);
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "post-1" },
        data: expect.objectContaining({
          metricsLikes: 42,
          metricsComments: 5,
          metricsShares: 10,
          metricsImpressions: 1000,
          metricsReach: 800,
          metricsSaves: 3,
          metricsUpdatedAt: expect.any(Date),
        }),
      })
    );

    fetchSpy.mockRestore();
  });

  it("caps refresh at 50 posts (oldest-stale first)", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    await runMetricsRefresh();

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 50,
        orderBy: expect.objectContaining({ metricsUpdatedAt: "asc" }),
      })
    );
  });
});
