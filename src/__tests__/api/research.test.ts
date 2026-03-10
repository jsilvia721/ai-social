import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/research", () => ({
  runResearchPipeline: jest.fn(),
}));

import { GET, POST } from "@/app/api/research/route";
import { runResearchPipeline } from "@/lib/research";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeGetRequest(params?: Record<string, string>) {
  const url = new URL("http://localhost/api/research");
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new NextRequest(url.toString());
}

function makePostRequest(body: object) {
  return new NextRequest("http://localhost/api/research", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

// ── GET /api/research ───────────────────────────────────────────────────────

describe("GET /api/research", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET(makeGetRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when businessId is missing", async () => {
    mockAuthenticated();
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("businessId");
  });

  it("returns 403 when user is not a member", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue(null);

    const res = await GET(makeGetRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(403);
  });

  it("returns research summaries for a valid member", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({
      id: "bm-1",
      businessId: "biz-1",
      userId: mockSession.user.id,
      role: "OWNER",
    } as any);

    const fakeSummaries = [
      { id: "rs-1", businessId: "biz-1", sourcesUsed: ["rss"], createdAt: new Date() },
    ];
    prismaMock.researchSummary.findMany.mockResolvedValue(fakeSummaries as any);

    const res = await GET(makeGetRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("rs-1");
  });

  it("respects limit param capped at 50", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.researchSummary.findMany.mockResolvedValue([]);

    await GET(makeGetRequest({ businessId: "biz-1", limit: "100" }));

    expect(prismaMock.researchSummary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  it("defaults limit to 10", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.researchSummary.findMany.mockResolvedValue([]);

    await GET(makeGetRequest({ businessId: "biz-1" }));

    expect(prismaMock.researchSummary.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 })
    );
  });

  it("verifies membership with correct composite key", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.researchSummary.findMany.mockResolvedValue([]);

    await GET(makeGetRequest({ businessId: "biz-1" }));

    expect(prismaMock.businessMember.findUnique).toHaveBeenCalledWith({
      where: {
        businessId_userId: {
          businessId: "biz-1",
          userId: mockSession.user.id,
        },
      },
    });
  });
});

// ── POST /api/research ──────────────────────────────────────────────────────

describe("POST /api/research", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await POST(makePostRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when businessId is missing", async () => {
    mockAuthenticated();
    const res = await POST(makePostRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 403 when user is not a member", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue(null);

    const res = await POST(makePostRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when business has no content strategy", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.contentStrategy.findUnique.mockResolvedValue(null);

    const res = await POST(makePostRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("content strategy");
  });

  it("triggers research pipeline and returns 201", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.contentStrategy.findUnique.mockResolvedValue({ id: "cs-1" } as any);
    (runResearchPipeline as jest.Mock).mockResolvedValue({ processed: 1 });

    const res = await POST(makePostRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.processed).toBe(1);
    expect(runResearchPipeline).toHaveBeenCalled();
  });

  it("handles malformed JSON body gracefully", async () => {
    mockAuthenticated();
    const req = new NextRequest("http://localhost/api/research", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
