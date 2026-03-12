import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/blotato/accounts", () => ({
  listAccounts: jest.fn(),
}));

import { GET } from "@/app/api/connect/blotato/route";
import { NextRequest } from "next/server";
import { listAccounts } from "@/lib/blotato/accounts";

const mockListAccounts = listAccounts as jest.Mock;

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/connect/blotato");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
  delete process.env.BLOTATO_MOCK;
});

describe("GET /api/connect/blotato", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET(makeRequest({ platform: "TWITTER", businessId: "biz-1" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when platform is missing", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({ businessId: "biz-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("platform");
  });

  it("returns 400 when businessId is missing", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({ platform: "TWITTER" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("businessId");
  });

  it("returns 403 when user is not a member of the business", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue(null);
    const res = await GET(makeRequest({ platform: "TWITTER", businessId: "biz-1" }));
    expect(res.status).toBe(403);
    expect(prismaMock.businessMember.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: mockSession.user.id,
          businessId: "biz-1",
        }),
      })
    );
  });

  it("fetches Blotato accounts and imports matching platform account", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue({
      id: "mem-1",
      businessId: "biz-1",
      userId: mockSession.user.id,
      role: "OWNER",
      joinedAt: new Date(),
    } as any);
    mockListAccounts.mockResolvedValue([
      { id: "acct-123", platform: "twitter", username: "mytwitter" },
      { id: "acct-456", platform: "instagram", username: "myinsta" },
    ]);
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    const res = await GET(makeRequest({ platform: "TWITTER", businessId: "biz-1" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/dashboard/accounts?success=true");
    expect(prismaMock.socialAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platform_platformId: {
            platform: "TWITTER",
            platformId: "acct-123",
          },
        },
        create: expect.objectContaining({
          businessId: "biz-1",
          blotatoAccountId: "acct-123",
          platform: "TWITTER",
          username: "mytwitter",
          platformId: "acct-123",
        }),
      })
    );
  });

  it("redirects with error=not_on_blotato when no matching platform account found", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue({ id: "mem-1" } as any);
    mockListAccounts.mockResolvedValue([
      { id: "acct-456", platform: "instagram", username: "myinsta" },
    ]);

    const res = await GET(makeRequest({ platform: "TWITTER", businessId: "biz-1" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=not_on_blotato");
    expect(prismaMock.socialAccount.upsert).not.toHaveBeenCalled();
  });

  it("redirects with error=connect when Blotato API call fails", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue({ id: "mem-1" } as any);
    mockListAccounts.mockRejectedValue(new Error("Blotato API error"));

    const res = await GET(makeRequest({ platform: "TWITTER", businessId: "biz-1" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=connect");
  });

  it("mock mode: creates a fake account and redirects to accounts page", async () => {
    process.env.BLOTATO_MOCK = "true";
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue({ id: "mem-1" } as any);
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    const res = await GET(makeRequest({ platform: "TWITTER", businessId: "biz-1" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/dashboard/accounts?success=true");
    expect(prismaMock.socialAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          platform: "TWITTER",
          businessId: "biz-1",
          username: "mockuser_twitter",
        }),
      })
    );
    expect(mockListAccounts).not.toHaveBeenCalled();
  });
});
