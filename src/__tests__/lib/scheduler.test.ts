import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/blotato/publish");
jest.mock("@/lib/blotato/metrics");
jest.mock("@/lib/alerts");
jest.mock("@/lib/server-error-reporter");

import { runScheduler, runMetricsRefresh } from "@/lib/scheduler";
import { publishPost } from "@/lib/blotato/publish";
import { getPostMetrics } from "@/lib/blotato/metrics";
import { sendFailureAlert } from "@/lib/alerts";
import { reportServerError } from "@/lib/server-error-reporter";

const mockPublishPost = publishPost as jest.MockedFunction<typeof publishPost>;
const mockGetPostMetrics = getPostMetrics as jest.MockedFunction<typeof getPostMetrics>;
const mockSendFailureAlert = sendFailureAlert as jest.MockedFunction<typeof sendFailureAlert>;
const mockReportServerError = reportServerError as jest.MockedFunction<typeof reportServerError>;

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
  // Default: error reporter succeeds
  mockReportServerError.mockResolvedValue(undefined);
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
      [],
      { coverImageUrl: undefined },
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

  it("fails immediately when Instagram post has no media (no API call made)", async () => {
    const post = makePost({
      status: "SCHEDULED",
      retryCount: 0,
    });
    // Override socialAccount to Instagram
    (post as any).socialAccount = { ...mockSocialAccount, platform: "INSTAGRAM" };

    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    // Should NOT call the Blotato API
    expect(mockPublishPost).not.toHaveBeenCalled();
    // Should go straight to FAILED (400 is non-retryable)
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: expect.stringContaining("requires at least one image or video"),
        }),
      })
    );
    // Should send failure alert
    expect(mockSendFailureAlert).toHaveBeenCalled();
  });

  it("fails immediately when TikTok post has no media (no API call made)", async () => {
    const post = makePost({
      status: "SCHEDULED",
      retryCount: 0,
    });
    (post as any).socialAccount = { ...mockSocialAccount, platform: "TIKTOK" };

    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    expect(mockPublishPost).not.toHaveBeenCalled();
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: expect.stringContaining("TIKTOK requires at least one image or video"),
        }),
      })
    );
  });

  it("publishes normally when Instagram post has media", async () => {
    const post = makePost({ status: "SCHEDULED", retryCount: 0 });
    (post as any).socialAccount = { ...mockSocialAccount, platform: "INSTAGRAM" };
    (post as any).mediaUrls = ["https://example.com/image.jpg"];

    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    mockPublishPost.mockResolvedValue({ blotatoPostId: "blotato-ig-1" });
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    expect(mockPublishPost).toHaveBeenCalled();
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PUBLISHED" }),
      })
    );
  });

  it("calls reportServerError on retry failure path", async () => {
    const post = makePost({ status: "SCHEDULED", retryCount: 0 });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    mockPublishPost.mockRejectedValue(new Error("Network error"));
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    expect(mockReportServerError).toHaveBeenCalledWith(
      "Network error",
      expect.objectContaining({
        url: "cron/publish",
        metadata: expect.objectContaining({
          postId: "post-1",
          platform: "TWITTER",
          businessId: "biz-1",
          retryCount: 1,
          source: "blotato-publish",
        }),
      })
    );
  });

  it("calls reportServerError on final failure path", async () => {
    const post = makePost({ status: "RETRYING", retryCount: 2 });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    mockPublishPost.mockRejectedValue(new Error("Blotato down"));
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    expect(mockReportServerError).toHaveBeenCalledWith(
      "Blotato down",
      expect.objectContaining({
        url: "cron/publish",
        metadata: expect.objectContaining({
          postId: "post-1",
          platform: "TWITTER",
          businessId: "biz-1",
          retryCount: 3,
          source: "blotato-publish",
        }),
      })
    );
  });

  it("calls reportServerError for media validation failures", async () => {
    const post = makePost({ status: "SCHEDULED", retryCount: 0 });
    (post as any).socialAccount = { ...mockSocialAccount, platform: "INSTAGRAM" };
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.post.update.mockResolvedValue(post as any);

    await runScheduler();

    expect(mockReportServerError).toHaveBeenCalledWith(
      expect.stringContaining("requires at least one image or video"),
      expect.objectContaining({
        url: "cron/publish",
        metadata: expect.objectContaining({
          postId: "post-1",
          platform: "INSTAGRAM",
          source: "blotato-publish",
        }),
      })
    );
  });

  it("does not crash if reportServerError throws (fire-and-forget)", async () => {
    const post = makePost({ status: "SCHEDULED", retryCount: 0 });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    prismaMock.post.updateMany.mockResolvedValue({ count: 1 });
    mockPublishPost.mockRejectedValue(new Error("Boom"));
    prismaMock.post.update.mockResolvedValue(post as any);
    mockReportServerError.mockRejectedValue(new Error("DB dead"));

    // Should NOT throw despite reportServerError throwing
    await expect(runScheduler()).resolves.toEqual({ processed: 1 });
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

    mockGetPostMetrics.mockResolvedValue(mockMetrics);
    prismaMock.post.update.mockResolvedValue(publishedPost as any);

    const result = await runMetricsRefresh();

    expect(result.processed).toBe(1);
    expect(mockGetPostMetrics).toHaveBeenCalledWith("blotato-post-abc");
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

  it("calls reportServerError when getPostMetrics throws", async () => {
    const publishedPost = {
      ...makePost({ status: "PUBLISHED" }),
      blotatoPostId: "blotato-post-abc",
    };
    prismaMock.post.findMany.mockResolvedValue([publishedPost] as any);
    mockGetPostMetrics.mockRejectedValue(new Error("Metrics API down"));

    await runMetricsRefresh();

    expect(mockReportServerError).toHaveBeenCalledWith(
      "Metrics API down",
      expect.objectContaining({
        url: "cron/metrics",
        metadata: expect.objectContaining({
          count: 1,
          postIds: ["post-1"],
          blotatoPostIds: ["blotato-post-abc"],
          sampleMessage: "Metrics API down",
          source: "blotato-metrics",
        }),
      })
    );
  });

  it("still processes remaining posts when one fails (allSettled resilience)", async () => {
    const post1 = {
      ...makePost({ id: "post-1", status: "PUBLISHED" }),
      blotatoPostId: "blotato-1",
    };
    const post2 = {
      ...makePost({ id: "post-2", status: "PUBLISHED" }),
      blotatoPostId: "blotato-2",
    };
    prismaMock.post.findMany.mockResolvedValue([post1, post2] as any);
    // First post fails, second succeeds
    mockGetPostMetrics
      .mockRejectedValueOnce(new Error("Metrics API down"))
      .mockResolvedValueOnce({
        likes: 10,
        comments: 2,
        shares: 1,
        impressions: 500,
        reach: 400,
        saves: 0,
      });
    prismaMock.post.update.mockResolvedValue(post2 as any);

    const result = await runMetricsRefresh();

    // Both posts counted as processed
    expect(result.processed).toBe(2);
    // Second post's metrics should still be updated
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "post-2" },
        data: expect.objectContaining({
          metricsLikes: 10,
        }),
      })
    );
    // Error reported with aggregated metadata
    expect(mockReportServerError).toHaveBeenCalledWith(
      "Metrics API down",
      expect.objectContaining({
        url: "cron/metrics",
        metadata: expect.objectContaining({
          count: 1,
          postIds: ["post-1"],
          blotatoPostIds: ["blotato-1"],
          sampleMessage: "Metrics API down",
          source: "blotato-metrics",
        }),
      })
    );
  });

  it("clears blotatoPostId when getPostMetrics throws BlotatoApiError with 404", async () => {
    const { BlotatoApiError } = await import("@/lib/blotato/client");
    const publishedPost = {
      ...makePost({ status: "PUBLISHED" }),
      blotatoPostId: "blotato-post-abc",
    };
    prismaMock.post.findMany.mockResolvedValue([publishedPost] as any);
    mockGetPostMetrics.mockRejectedValue(
      new BlotatoApiError("Not found", 404)
    );
    prismaMock.post.update.mockResolvedValue(publishedPost as any);

    const consoleSpy = jest.spyOn(console, "info").mockImplementation();

    await runMetricsRefresh();

    // Should clear the stale blotatoPostId
    expect(prismaMock.post.update).toHaveBeenCalledWith({
      where: { id: "post-1" },
      data: { blotatoPostId: null },
    });
    // 404 errors should NOT be reported
    expect(mockReportServerError).not.toHaveBeenCalled();
    // Should log at info level instead
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Clearing stale blotatoPostId for post post-1")
    );

    consoleSpy.mockRestore();
  });

  it("updates metricsUpdatedAt for non-404 errors to rotate post to back of queue", async () => {
    const { BlotatoApiError } = await import("@/lib/blotato/client");
    const publishedPost = {
      ...makePost({ status: "PUBLISHED" }),
      blotatoPostId: "blotato-post-abc",
    };
    prismaMock.post.findMany.mockResolvedValue([publishedPost] as any);
    mockGetPostMetrics.mockRejectedValue(
      new BlotatoApiError("Rate limited", 429)
    );
    prismaMock.post.update.mockResolvedValue(publishedPost as any);

    await runMetricsRefresh();

    expect(prismaMock.post.update).toHaveBeenCalledWith({
      where: { id: "post-1" },
      data: { metricsUpdatedAt: expect.any(Date) },
    });
    // Should NOT clear blotatoPostId for non-404 errors
    expect(prismaMock.post.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: { blotatoPostId: null },
      })
    );
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("updates metricsUpdatedAt for generic (non-BlotatoApiError) errors", async () => {
    const publishedPost = {
      ...makePost({ status: "PUBLISHED" }),
      blotatoPostId: "blotato-post-abc",
    };
    prismaMock.post.findMany.mockResolvedValue([publishedPost] as any);
    mockGetPostMetrics.mockRejectedValue(new Error("Network timeout"));
    prismaMock.post.update.mockResolvedValue(publishedPost as any);

    await runMetricsRefresh();

    expect(prismaMock.post.update).toHaveBeenCalledWith({
      where: { id: "post-1" },
      data: { metricsUpdatedAt: expect.any(Date) },
    });
    expect(mockReportServerError).toHaveBeenCalled();
  });

  it("aggregates errors by pattern: 3 posts with same error → 1 reportServerError call", async () => {
    const posts = [
      { ...makePost({ id: "post-1", status: "PUBLISHED" }), blotatoPostId: "blotato-1" },
      { ...makePost({ id: "post-2", status: "PUBLISHED" }), blotatoPostId: "blotato-2" },
      { ...makePost({ id: "post-3", status: "PUBLISHED" }), blotatoPostId: "blotato-3" },
    ];
    prismaMock.post.findMany.mockResolvedValue(posts as any);
    mockGetPostMetrics
      .mockRejectedValueOnce(new Error("Blotato API error 500"))
      .mockRejectedValueOnce(new Error("Blotato API error 500"))
      .mockRejectedValueOnce(new Error("Blotato API error 500"));
    prismaMock.post.update.mockResolvedValue(posts[0] as any);

    await runMetricsRefresh();

    // Should be called exactly once for the single unique error pattern
    expect(mockReportServerError).toHaveBeenCalledTimes(1);
    expect(mockReportServerError).toHaveBeenCalledWith(
      "Blotato API error 500",
      expect.objectContaining({
        url: "cron/metrics",
        metadata: expect.objectContaining({
          count: 3,
          postIds: ["post-1", "post-2", "post-3"],
          blotatoPostIds: ["blotato-1", "blotato-2", "blotato-3"],
          sampleMessage: "Blotato API error 500",
          source: "blotato-metrics",
        }),
      })
    );
  });

  it("aggregates errors by pattern: 2 different errors → 2 reportServerError calls", async () => {
    const posts = [
      { ...makePost({ id: "post-1", status: "PUBLISHED" }), blotatoPostId: "blotato-1" },
      { ...makePost({ id: "post-2", status: "PUBLISHED" }), blotatoPostId: "blotato-2" },
      { ...makePost({ id: "post-3", status: "PUBLISHED" }), blotatoPostId: "blotato-3" },
    ];
    prismaMock.post.findMany.mockResolvedValue(posts as any);
    mockGetPostMetrics
      .mockRejectedValueOnce(new Error("Blotato API error 500"))
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockRejectedValueOnce(new Error("Blotato API error 500"));
    prismaMock.post.update.mockResolvedValue(posts[0] as any);

    await runMetricsRefresh();

    // Should be called twice — once per unique error pattern
    expect(mockReportServerError).toHaveBeenCalledTimes(2);
    expect(mockReportServerError).toHaveBeenCalledWith(
      "Blotato API error 500",
      expect.objectContaining({
        metadata: expect.objectContaining({
          count: 2,
          postIds: ["post-1", "post-3"],
          blotatoPostIds: ["blotato-1", "blotato-3"],
        }),
      })
    );
    expect(mockReportServerError).toHaveBeenCalledWith(
      "Network timeout",
      expect.objectContaining({
        metadata: expect.objectContaining({
          count: 1,
          postIds: ["post-2"],
          blotatoPostIds: ["blotato-2"],
        }),
      })
    );
  });

  it("does not crash if reportServerError throws during metrics refresh", async () => {
    const publishedPost = {
      ...makePost({ status: "PUBLISHED" }),
      blotatoPostId: "blotato-post-abc",
    };
    prismaMock.post.findMany.mockResolvedValue([publishedPost] as any);
    mockGetPostMetrics.mockRejectedValue(new Error("API down"));
    mockReportServerError.mockRejectedValue(new Error("DB dead"));

    // Should NOT throw despite both getPostMetrics and reportServerError failing
    await expect(runMetricsRefresh()).resolves.toEqual({ processed: 1 });
  });
});
