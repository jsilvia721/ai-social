import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/blotato/accounts", () => ({
  getConnectUrl: jest.fn(),
}));

import { GET } from "@/app/api/connect/blotato/route";
import { NextRequest } from "next/server";
import { getConnectUrl } from "@/lib/blotato/accounts";

const mockGetConnectUrl = getConnectUrl as jest.Mock;

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/connect/blotato");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
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

  it("redirects to the Blotato OAuth URL when user is a member", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue({
      id: "mem-1",
      businessId: "biz-1",
      userId: mockSession.user.id,
      role: "OWNER",
      joinedAt: new Date(),
    } as any);
    mockGetConnectUrl.mockResolvedValue({ url: "https://app.blotato.com/connect/oauth" });

    const res = await GET(makeRequest({ platform: "TWITTER", businessId: "biz-1" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.blotato.com/connect/oauth");
  });

  it("calls getConnectUrl with encoded state containing userId and businessId", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findFirst.mockResolvedValue({ id: "mem-1" } as any);
    mockGetConnectUrl.mockResolvedValue({ url: "https://app.blotato.com/connect/oauth" });

    await GET(makeRequest({ platform: "INSTAGRAM", businessId: "biz-42" }));

    expect(mockGetConnectUrl).toHaveBeenCalledWith(
      "INSTAGRAM",
      expect.stringContaining("/api/connect/blotato/callback"),
      expect.any(String),
    );

    // state should be decodable and contain userId + businessId
    const [, , state] = mockGetConnectUrl.mock.calls[0] as [string, string, string];
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString());
    expect(decoded.userId).toBe(mockSession.user.id);
    expect(decoded.businessId).toBe("biz-42");
  });
});
