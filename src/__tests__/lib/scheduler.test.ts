import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/token", () => ({ ensureValidToken: jest.fn() }));
jest.mock("@/lib/analytics/fetchers", () => ({
  fetchTwitterMetrics: jest.fn(),
  fetchFacebookMetrics: jest.fn(),
  fetchInstagramMetrics: jest.fn(),
}));
// Platform publishers are only used by runScheduler (covered separately via
// the /api/schedule route tests), but we mock them here so the module loads.
jest.mock("@/lib/platforms/twitter", () => ({ publishTweet: jest.fn() }));
jest.mock("@/lib/platforms/instagram", () => ({ publishInstagramPost: jest.fn() }));
jest.mock("@/lib/platforms/facebook", () => ({ publishFacebookPost: jest.fn() }));

import { runMetricsRefresh } from "@/lib/scheduler";
import { ensureValidToken } from "@/lib/token";
import {
  fetchTwitterMetrics,
  fetchFacebookMetrics,
  fetchInstagramMetrics,
} from "@/lib/analytics/fetchers";

const mockEnsureValidToken = ensureValidToken as jest.Mock;
const mockFetchTwitterMetrics = fetchTwitterMetrics as jest.Mock;
const mockFetchFacebookMetrics = fetchFacebookMetrics as jest.Mock;
const mockFetchInstagramMetrics = fetchInstagramMetrics as jest.Mock;

// ── fixtures ─────────────────────────────────────────────────────────────────

const METRICS = {
  metricsLikes: 10,
  metricsComments: 3,
  metricsShares: 2,
  metricsImpressions: 500,
  metricsReach: null,
  metricsSaves: null,
  metricsUpdatedAt: new Date(),
};

function makeSocialAccount(platform: "TWITTER" | "INSTAGRAM" | "FACEBOOK" = "TWITTER") {
  return {
    id: "account-1",
    platform,
    platformId: "platform-user-id",
    accessToken: "access-token",
    refreshToken: null,
    expiresAt: null,
  };
}

function makePost(
  overrides: { id?: string; platform?: "TWITTER" | "INSTAGRAM" | "FACEBOOK" } = {}
) {
  const { id = "post-1", platform = "TWITTER" } = overrides;
  return {
    id,
    platformPostId: `platform-${id}`,
    metricsUpdatedAt: null,
    socialAccount: makeSocialAccount(platform),
  };
}

// ── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
  mockEnsureValidToken.mockImplementation((account: { accessToken: string }) =>
    Promise.resolve(account.accessToken)
  );
});

// ── runMetricsRefresh ────────────────────────────────────────────────────────

describe("runMetricsRefresh", () => {
  it("does nothing when there are no stale published posts", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    await runMetricsRefresh();

    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it("calls fetchTwitterMetrics for TWITTER posts", async () => {
    prismaMock.post.findMany.mockResolvedValue([makePost({ platform: "TWITTER" })] as any);
    mockFetchTwitterMetrics.mockResolvedValue(METRICS);
    prismaMock.post.update.mockResolvedValue({} as any);

    await runMetricsRefresh();

    expect(mockFetchTwitterMetrics).toHaveBeenCalledWith("access-token", "platform-post-1");
    expect(mockFetchFacebookMetrics).not.toHaveBeenCalled();
    expect(mockFetchInstagramMetrics).not.toHaveBeenCalled();
  });

  it("calls fetchInstagramMetrics for INSTAGRAM posts", async () => {
    prismaMock.post.findMany.mockResolvedValue([makePost({ platform: "INSTAGRAM" })] as any);
    mockFetchInstagramMetrics.mockResolvedValue(METRICS);
    prismaMock.post.update.mockResolvedValue({} as any);

    await runMetricsRefresh();

    expect(mockFetchInstagramMetrics).toHaveBeenCalledWith("access-token", "platform-post-1");
    expect(mockFetchTwitterMetrics).not.toHaveBeenCalled();
  });

  it("calls fetchFacebookMetrics for FACEBOOK posts", async () => {
    prismaMock.post.findMany.mockResolvedValue([makePost({ platform: "FACEBOOK" })] as any);
    mockFetchFacebookMetrics.mockResolvedValue(METRICS);
    prismaMock.post.update.mockResolvedValue({} as any);

    await runMetricsRefresh();

    expect(mockFetchFacebookMetrics).toHaveBeenCalledWith("access-token", "platform-post-1");
    expect(mockFetchTwitterMetrics).not.toHaveBeenCalled();
  });

  it("updates the post with the metrics returned by the fetcher", async () => {
    prismaMock.post.findMany.mockResolvedValue([makePost()] as any);
    mockFetchTwitterMetrics.mockResolvedValue(METRICS);
    prismaMock.post.update.mockResolvedValue({} as any);

    await runMetricsRefresh();

    expect(prismaMock.post.update).toHaveBeenCalledWith({
      where: { id: "post-1" },
      data: METRICS,
    });
  });

  it("skips the update when the fetcher returns null", async () => {
    prismaMock.post.findMany.mockResolvedValue([makePost()] as any);
    mockFetchTwitterMetrics.mockResolvedValue(null);

    await runMetricsRefresh();

    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it("does not throw when ensureValidToken rejects", async () => {
    prismaMock.post.findMany.mockResolvedValue([makePost()] as any);
    mockEnsureValidToken.mockRejectedValue(new Error("Token expired"));

    await expect(runMetricsRefresh()).resolves.not.toThrow();
    expect(prismaMock.post.update).not.toHaveBeenCalled();
  });

  it("continues processing remaining posts when one fails", async () => {
    const posts = [makePost({ id: "post-1" }), makePost({ id: "post-2" })];
    prismaMock.post.findMany.mockResolvedValue(posts as any);
    mockFetchTwitterMetrics
      .mockRejectedValueOnce(new Error("API error"))
      .mockResolvedValueOnce(METRICS);
    prismaMock.post.update.mockResolvedValue({} as any);

    await runMetricsRefresh();

    // post-1 errored inside the per-post try/catch, post-2 succeeded
    expect(prismaMock.post.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.post.update).toHaveBeenCalledWith({
      where: { id: "post-2" },
      data: METRICS,
    });
  });

  it("uses the token returned by ensureValidToken, not the raw accessToken", async () => {
    prismaMock.post.findMany.mockResolvedValue([makePost()] as any);
    mockEnsureValidToken.mockResolvedValue("refreshed-token");
    mockFetchTwitterMetrics.mockResolvedValue(METRICS);
    prismaMock.post.update.mockResolvedValue({} as any);

    await runMetricsRefresh();

    expect(mockFetchTwitterMetrics).toHaveBeenCalledWith(
      "refreshed-token",
      expect.any(String)
    );
  });
});
