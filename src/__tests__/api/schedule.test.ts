import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));

// Mock platform modules with jest.fn() inside the factory to avoid
// variable hoisting issues, then access via the imported module references.
jest.mock("@/lib/platforms/twitter", () => ({ publishTweet: jest.fn() }));
jest.mock("@/lib/platforms/instagram", () => ({ publishInstagramPost: jest.fn() }));
jest.mock("@/lib/platforms/facebook", () => ({ publishFacebookPost: jest.fn() }));
jest.mock("@/lib/token", () => ({ ensureValidToken: jest.fn() }));

import { GET, POST } from "@/app/api/schedule/route";
import { NextRequest } from "next/server";
import { publishTweet } from "@/lib/platforms/twitter";
import { publishInstagramPost } from "@/lib/platforms/instagram";
import { publishFacebookPost } from "@/lib/platforms/facebook";
import { ensureValidToken } from "@/lib/token";

const mockPublishTweet = publishTweet as jest.Mock;
const mockPublishInstagramPost = publishInstagramPost as jest.Mock;
const mockPublishFacebookPost = publishFacebookPost as jest.Mock;
const mockEnsureValidToken = ensureValidToken as jest.Mock;

const makeRequest = (method = "POST", headers?: Record<string, string>) =>
  new NextRequest("http://localhost/api/schedule", { method, headers });

function makePost(overrides: object) {
  return {
    id: "post-1",
    content: "Test content",
    mediaUrls: [],
    status: "SCHEDULED",
    scheduledAt: new Date(Date.now() - 1000), // 1 second in the past
    socialAccount: {
      platform: "TWITTER",
      platformId: "tw-user-id",
      accessToken: "access-token",
    },
    ...overrides,
  };
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
  // Default: return the account's accessToken unchanged
  mockEnsureValidToken.mockImplementation((account: { accessToken: string }) =>
    Promise.resolve(account.accessToken)
  );
});

describe("POST /api/schedule", () => {
  it("returns processed: 0 when there are no due posts", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    const res = await POST(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
  });

  it("publishes a Twitter post and marks it as PUBLISHED", async () => {
    const post = makePost({ socialAccount: { platform: "TWITTER", platformId: "tw-id", accessToken: "tw-token" } });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    mockPublishTweet.mockResolvedValue({ id: "tweet-123", url: "https://twitter.com/i/web/status/tweet-123" });
    prismaMock.post.update.mockResolvedValue({ ...post, status: "PUBLISHED" } as any);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(mockPublishTweet).toHaveBeenCalledWith("tw-token", "Test content", []);
    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PUBLISHED", platformPostId: "tweet-123" }),
      })
    );
    expect(body.processed).toBe(1);
  });

  it("passes mediaUrls to publishTweet", async () => {
    const post = makePost({
      mediaUrls: ["https://example.com/img.jpg"],
      socialAccount: { platform: "TWITTER", platformId: "tw-id", accessToken: "tw-token" },
    });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    mockPublishTweet.mockResolvedValue({ id: "tweet-123", url: "https://twitter.com/i/web/status/tweet-123" });
    prismaMock.post.update.mockResolvedValue({} as any);

    await POST(makeRequest());

    expect(mockPublishTweet).toHaveBeenCalledWith(
      "tw-token",
      "Test content",
      ["https://example.com/img.jpg"]
    );
  });

  it("publishes an Instagram post via publishInstagramPost", async () => {
    const post = makePost({
      content: "IG caption",
      mediaUrls: ["https://example.com/img.jpg"],
      socialAccount: { platform: "INSTAGRAM", platformId: "ig-user-id", accessToken: "ig-token" },
    });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    mockPublishInstagramPost.mockResolvedValue({ id: "ig-post-1" });
    prismaMock.post.update.mockResolvedValue({ ...post, status: "PUBLISHED" } as any);

    await POST(makeRequest());

    expect(mockPublishInstagramPost).toHaveBeenCalledWith(
      "ig-token",
      "ig-user-id",
      "IG caption",
      "https://example.com/img.jpg"
    );
  });

  it("publishes a Facebook post via publishFacebookPost", async () => {
    const post = makePost({
      socialAccount: { platform: "FACEBOOK", platformId: "page-id", accessToken: "page-token" },
    });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    mockPublishFacebookPost.mockResolvedValue({ id: "fb-post-1" });
    prismaMock.post.update.mockResolvedValue({ ...post, status: "PUBLISHED" } as any);

    await POST(makeRequest());

    expect(mockPublishFacebookPost).toHaveBeenCalledWith(
      "page-token",
      "page-id",
      "Test content"
    );
  });

  it("marks a post as FAILED when publishing throws", async () => {
    const post = makePost({ id: "post-fail" });
    prismaMock.post.findMany.mockResolvedValue([post] as any);
    mockPublishTweet.mockRejectedValue(new Error("Twitter API error"));
    prismaMock.post.update.mockResolvedValue({ ...post, status: "FAILED" } as any);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(prismaMock.post.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "post-fail" },
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: "Twitter API error",
        }),
      })
    );
    expect(body.processed).toBe(1);
  });

  it("processes mixed success and failure posts independently", async () => {
    const successPost = makePost({ id: "post-ok" });
    const failPost = makePost({
      id: "post-bad",
      socialAccount: { platform: "INSTAGRAM", platformId: "ig-id", accessToken: "token" },
    });
    prismaMock.post.findMany.mockResolvedValue([successPost, failPost] as any);
    mockPublishTweet.mockResolvedValue({ id: "tweet-ok", url: "https://twitter.com/i/web/status/tweet-ok" });
    mockPublishInstagramPost.mockRejectedValue(new Error("IG error"));
    prismaMock.post.update.mockResolvedValue({} as any);

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.processed).toBe(2);
    // Both posts should have been attempted
    expect(prismaMock.post.update).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/schedule (Vercel Cron)", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it("runs scheduler and returns results when no CRON_SECRET is set", async () => {
    process.env = { ...originalEnv, CRON_SECRET: undefined };
    prismaMock.post.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
  });

  it("runs scheduler when correct CRON_SECRET is provided", async () => {
    process.env = { ...originalEnv, CRON_SECRET: "secret-abc" };
    prismaMock.post.findMany.mockResolvedValue([]);

    const res = await GET(makeRequest("GET", { authorization: "Bearer secret-abc" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processed).toBe(0);
  });

  it("returns 401 when CRON_SECRET is set but Authorization header is missing", async () => {
    process.env = { ...originalEnv, CRON_SECRET: "secret-abc" };

    const res = await GET(makeRequest("GET"));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when CRON_SECRET is set but Authorization header is wrong", async () => {
    process.env = { ...originalEnv, CRON_SECRET: "secret-abc" };

    const res = await GET(makeRequest("GET", { authorization: "Bearer wrong-secret" }));

    expect(res.status).toBe(401);
  });
});
