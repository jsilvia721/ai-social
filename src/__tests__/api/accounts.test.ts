import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
// Mock auth entirely to avoid importing ESM-only @auth/prisma-adapter
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET, DELETE } from "@/app/api/accounts/route";
import { NextRequest } from "next/server";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

const makeGetRequest = (url = "http://localhost/api/accounts") => new NextRequest(url);
const makeRequest = (url: string) => new NextRequest(url);

describe("GET /api/accounts", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns the user's connected accounts across all their businesses", async () => {
    mockAuthenticated();
    const fakeAccounts = [
      {
        id: "account-1",
        businessId: "biz-1",
        platform: "TWITTER",
        username: "testuser",
        blotatoAccountId: "blotato-123",
        createdAt: new Date("2025-01-01"),
      },
    ];
    prismaMock.socialAccount.findMany.mockResolvedValue(fakeAccounts as any);

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].platform).toBe("TWITTER");
    expect(body[0].username).toBe("testuser");
  });

  it("filters accounts by business membership (not direct userId)", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findMany.mockResolvedValue([]);

    await GET(makeGetRequest());

    expect(prismaMock.socialAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { business: { members: { some: { userId: mockSession.user.id } } } },
      })
    );
  });

  it("filters by businessId when query param is provided", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findMany.mockResolvedValue([]);

    await GET(makeGetRequest("http://localhost/api/accounts?businessId=biz-1"));

    expect(prismaMock.socialAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: "biz-1" }),
      })
    );
  });

  it("never returns accessToken or refreshToken fields", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findMany.mockResolvedValue([
      { id: "acc-1", businessId: "biz-1", platform: "TWITTER", username: "user", blotatoAccountId: "b-1", createdAt: new Date() } as any,
    ]);

    const res = await GET(makeGetRequest());
    const body = await res.json();

    expect(body[0]).not.toHaveProperty("accessToken");
    expect(body[0]).not.toHaveProperty("refreshToken");
  });
});

describe("DELETE /api/accounts", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await DELETE(makeRequest("http://localhost/api/accounts?id=acc-1"));

    expect(res.status).toBe(401);
  });

  it("returns 400 when id param is missing", async () => {
    mockAuthenticated();

    const res = await DELETE(makeRequest("http://localhost/api/accounts"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Missing id");
  });

  it("returns 404 when account does not belong to user's businesses (IDOR prevention)", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue(null);

    const res = await DELETE(makeRequest("http://localhost/api/accounts?id=other-users-account"));

    expect(res.status).toBe(404);
    expect(prismaMock.socialAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          business: { members: { some: { userId: mockSession.user.id } } },
        }),
      })
    );
  });

  it("deletes the account and returns success when owned by current user", async () => {
    mockAuthenticated();
    const account = { id: "account-1", businessId: "biz-1" };
    prismaMock.socialAccount.findFirst.mockResolvedValue(account as any);
    prismaMock.socialAccount.delete.mockResolvedValue(account as any);

    const res = await DELETE(makeRequest("http://localhost/api/accounts?id=account-1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });
    expect(prismaMock.socialAccount.delete).toHaveBeenCalledWith({
      where: { id: "account-1" },
    });
  });
});
