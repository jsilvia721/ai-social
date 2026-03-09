import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { NextRequest } from "next/server";
import { GET, PATCH } from "@/app/api/businesses/[id]/strategy/route";

const BUSINESS_ID = "biz-1";
const UPDATED_AT = new Date("2026-03-09T10:00:00Z");

const mockParams = { params: Promise.resolve({ id: BUSINESS_ID }) };

function makeReq(method: string, body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/businesses/${BUSINESS_ID}/strategy`, {
    method,
    ...(body && {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  });
}

const FULL_STRATEGY = {
  industry: "Fitness",
  targetAudience: "Busy professionals",
  contentPillars: ["Workouts", "Nutrition"],
  brandVoice: "Energetic and science-backed",
  optimizationGoal: "ENGAGEMENT",
  reviewWindowEnabled: true,
  reviewWindowHours: 24,
  postingCadence: { TWITTER: 5, INSTAGRAM: 3 },
  formatMix: { TEXT: 0.3, IMAGE: 0.7 },
  researchSources: { rssFeeds: [], subreddits: [] },
  optimalTimeWindows: null,
  lastOptimizedAt: null,
  updatedAt: UPDATED_AT,
};

function mockOwner() {
  (prismaMock.businessMember.findUnique as jest.Mock).mockResolvedValue({
    userId: "user-test-id",
    businessId: BUSINESS_ID,
    role: "OWNER",
  });
}

function mockMember() {
  (prismaMock.businessMember.findUnique as jest.Mock).mockResolvedValue({
    userId: "user-test-id",
    businessId: BUSINESS_ID,
    role: "MEMBER",
  });
}

describe("GET /api/businesses/[id]/strategy", () => {
  beforeEach(() => {
    resetPrismaMock();
    mockAuthenticated();
  });

  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET(makeReq("GET"), mockParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not a member", async () => {
    (prismaMock.businessMember.findUnique as jest.Mock).mockResolvedValue(null);
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await GET(makeReq("GET"), mockParams);
    expect(res.status).toBe(403);
  });

  it("returns 404 when no strategy exists", async () => {
    mockMember();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await GET(makeReq("GET"), mockParams);
    expect(res.status).toBe(404);
  });

  it("returns full strategy for a member", async () => {
    mockMember();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(FULL_STRATEGY);

    const res = await GET(makeReq("GET"), mockParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.industry).toBe("Fitness");
    expect(body.contentPillars).toEqual(["Workouts", "Nutrition"]);
    expect(body.postingCadence).toEqual({ TWITTER: 5, INSTAGRAM: 3 });
    expect(body.updatedAt).toBeDefined();
  });
});

describe("PATCH /api/businesses/[id]/strategy", () => {
  beforeEach(() => {
    resetPrismaMock();
    mockAuthenticated();
  });

  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await PATCH(makeReq("PATCH", {}), mockParams);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is a MEMBER (not OWNER)", async () => {
    mockMember();

    const res = await PATCH(
      makeReq("PATCH", { updatedAt: UPDATED_AT.toISOString() }),
      mockParams
    );
    expect(res.status).toBe(403);
  });

  it("updates strategy fields and returns full strategy", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue({
      updatedAt: UPDATED_AT,
    });

    const newUpdatedAt = new Date("2026-03-09T11:00:00Z");
    (prismaMock.contentStrategy.update as jest.Mock).mockResolvedValue({
      ...FULL_STRATEGY,
      industry: "Health & Wellness",
      updatedAt: newUpdatedAt,
    });

    const res = await PATCH(
      makeReq("PATCH", {
        updatedAt: UPDATED_AT.toISOString(),
        industry: "Health & Wellness",
      }),
      mockParams
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.industry).toBe("Health & Wellness");
    expect(prismaMock.contentStrategy.update).toHaveBeenCalledWith({
      where: { businessId: BUSINESS_ID },
      data: { industry: "Health & Wellness" },
      select: expect.objectContaining({ industry: true, updatedAt: true }),
    });
  });

  it("returns 409 when updatedAt does not match (conflict)", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue({
      updatedAt: new Date("2026-03-09T12:00:00Z"), // different from client
    });

    const res = await PATCH(
      makeReq("PATCH", {
        updatedAt: UPDATED_AT.toISOString(),
        industry: "Changed",
      }),
      mockParams
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/modified/i);
  });

  it("returns 400 for invalid request body", async () => {
    mockOwner();

    const res = await PATCH(
      makeReq("PATCH", { updatedAt: UPDATED_AT.toISOString(), industry: "" }), // min(1) fails
      mockParams
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details).toBeDefined();
  });

  it("rejects unknown keys (.strict())", async () => {
    mockOwner();

    const res = await PATCH(
      makeReq("PATCH", {
        updatedAt: UPDATED_AT.toISOString(),
        unknownField: "nope",
      }),
      mockParams
    );

    expect(res.status).toBe(400);
  });

  it("validates RSS feed URLs must be HTTPS", async () => {
    mockOwner();

    const res = await PATCH(
      makeReq("PATCH", {
        updatedAt: UPDATED_AT.toISOString(),
        researchSources: {
          rssFeeds: ["http://example.com/feed.xml"],
          subreddits: [],
        },
      }),
      mockParams
    );

    expect(res.status).toBe(400);
  });

  it("validates subreddit names with regex", async () => {
    mockOwner();

    const res = await PATCH(
      makeReq("PATCH", {
        updatedAt: UPDATED_AT.toISOString(),
        researchSources: {
          rssFeeds: [],
          subreddits: ["../../etc/passwd"],
        },
      }),
      mockParams
    );

    expect(res.status).toBe(400);
  });

  it("accepts valid posting cadence and format mix", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue({
      updatedAt: UPDATED_AT,
    });
    (prismaMock.contentStrategy.update as jest.Mock).mockResolvedValue({
      ...FULL_STRATEGY,
      postingCadence: { TWITTER: 7 },
      formatMix: { TWITTER: { TEXT: 5, IMAGE: 5 } },
    });

    const res = await PATCH(
      makeReq("PATCH", {
        updatedAt: UPDATED_AT.toISOString(),
        postingCadence: { TWITTER: 7 },
        formatMix: { TWITTER: { TEXT: 5, IMAGE: 5 } },
      }),
      mockParams
    );

    expect(res.status).toBe(200);
  });

  it("accepts nullable cadence (AI-optimized) and null format mix per platform", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue({
      updatedAt: UPDATED_AT,
    });
    (prismaMock.contentStrategy.update as jest.Mock).mockResolvedValue({
      ...FULL_STRATEGY,
      postingCadence: { TWITTER: null, INSTAGRAM: 5 },
      formatMix: { TWITTER: { TEXT: 5, IMAGE: 5 }, INSTAGRAM: null },
    });

    const res = await PATCH(
      makeReq("PATCH", {
        updatedAt: UPDATED_AT.toISOString(),
        postingCadence: { TWITTER: null, INSTAGRAM: 5 },
        formatMix: { TWITTER: { TEXT: 5, IMAGE: 5 }, INSTAGRAM: null },
      }),
      mockParams
    );

    expect(res.status).toBe(200);
  });

  it("accepts valid research sources", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue({
      updatedAt: UPDATED_AT,
    });
    (prismaMock.contentStrategy.update as jest.Mock).mockResolvedValue({
      ...FULL_STRATEGY,
      researchSources: {
        rssFeeds: ["https://blog.example.com/feed.xml"],
        subreddits: ["marketing", "smallbusiness"],
      },
    });

    const res = await PATCH(
      makeReq("PATCH", {
        updatedAt: UPDATED_AT.toISOString(),
        researchSources: {
          rssFeeds: ["https://blog.example.com/feed.xml"],
          subreddits: ["marketing", "smallbusiness"],
        },
      }),
      mockParams
    );

    expect(res.status).toBe(200);
  });

  it("returns 404 when no strategy exists", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await PATCH(
      makeReq("PATCH", {
        updatedAt: UPDATED_AT.toISOString(),
        industry: "Tech",
      }),
      mockParams
    );

    expect(res.status).toBe(404);
  });
});
