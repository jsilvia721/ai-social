import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/blotato/accounts");

import { GET } from "@/app/api/accounts/available/route";
import { listAccounts } from "@/lib/blotato/accounts";
import { NextRequest } from "next/server";

const mockListAccounts = listAccounts as jest.MockedFunction<typeof listAccounts>;

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

const makeRequest = () => new NextRequest("http://localhost/api/accounts/available");

describe("GET /api/accounts/available", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when user has no active business", async () => {
    mockAuthenticated({
      ...mockSession,
      user: { ...mockSession.user, activeBusinessId: null as any },
    });

    const res = await GET(makeRequest());

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("active business");
  });

  it("returns 403 when user is not a member of the active business", async () => {
    mockAuthenticated();
    prismaMock.business.findFirst.mockResolvedValue(null);

    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("member");
  });

  it("filters to supported platforms only", async () => {
    mockAuthenticated();
    prismaMock.business.findFirst.mockResolvedValue({ id: "biz-1" } as any);
    prismaMock.socialAccount.findMany.mockResolvedValue([]);
    mockListAccounts.mockResolvedValue([
      { id: "acct-1", platform: "twitter", username: "user1" },
      { id: "acct-2", platform: "instagram", username: "user2" },
      { id: "acct-3", platform: "linkedin", username: "user3" }, // unsupported
      { id: "acct-4", platform: "threads", username: "user4" },  // unsupported
      { id: "acct-5", platform: "tiktok", username: "user5" },
    ]);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(3);
    const platforms = body.accounts.map((a: any) => a.platform);
    expect(platforms).toContain("TWITTER");
    expect(platforms).toContain("INSTAGRAM");
    expect(platforms).toContain("TIKTOK");
    expect(platforms).not.toContain("linkedin");
    expect(platforms).not.toContain("threads");
  });

  it("excludes already-imported accounts by blotatoAccountId", async () => {
    mockAuthenticated();
    prismaMock.business.findFirst.mockResolvedValue({ id: "biz-1" } as any);
    prismaMock.socialAccount.findMany.mockResolvedValue([
      { id: "sa-1", blotatoAccountId: "acct-1" } as any,
    ]);
    mockListAccounts.mockResolvedValue([
      { id: "acct-1", platform: "twitter", username: "already_imported" },
      { id: "acct-2", platform: "instagram", username: "available_user" },
    ]);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].username).toBe("available_user");
  });

  it("excludes accounts claimed by other businesses (global check)", async () => {
    mockAuthenticated();
    prismaMock.business.findFirst.mockResolvedValue({ id: "biz-1" } as any);
    // Global query returns account claimed by another business
    prismaMock.socialAccount.findMany.mockResolvedValue([
      { id: "sa-other", blotatoAccountId: "acct-1", businessId: "biz-other" } as any,
    ]);
    mockListAccounts.mockResolvedValue([
      { id: "acct-1", platform: "twitter", username: "claimed_by_other" },
      { id: "acct-2", platform: "instagram", username: "unclaimed" },
    ]);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].username).toBe("unclaimed");
  });

  it("returns mapped platform names (uppercase Prisma format)", async () => {
    mockAuthenticated();
    prismaMock.business.findFirst.mockResolvedValue({ id: "biz-1" } as any);
    prismaMock.socialAccount.findMany.mockResolvedValue([]);
    mockListAccounts.mockResolvedValue([
      { id: "acct-1", platform: "twitter", username: "user1" },
      { id: "acct-2", platform: "facebook", username: "user2" },
      { id: "acct-3", platform: "youtube", username: "user3" },
    ]);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts[0].platform).toBe("TWITTER");
    expect(body.accounts[1].platform).toBe("FACEBOOK");
    expect(body.accounts[2].platform).toBe("YOUTUBE");
  });

  it("handles Blotato API failure with 500 error", async () => {
    mockAuthenticated();
    prismaMock.business.findFirst.mockResolvedValue({ id: "biz-1" } as any);
    mockListAccounts.mockRejectedValue(new Error("Blotato API is down"));

    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Blotato");
  });

  it("allows admin to bypass membership check", async () => {
    const { mockAuthenticatedAsAdmin } = await import("@/__tests__/mocks/auth");
    mockAuthenticatedAsAdmin();
    prismaMock.socialAccount.findMany.mockResolvedValue([]);
    mockListAccounts.mockResolvedValue([
      { id: "acct-1", platform: "twitter", username: "user1" },
    ]);

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    // Admin should NOT trigger business.findFirst membership check
    expect(prismaMock.business.findFirst).not.toHaveBeenCalled();
  });
});
