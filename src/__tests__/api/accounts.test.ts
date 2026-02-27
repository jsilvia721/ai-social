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

const makeRequest = (url: string) => new NextRequest(url);

describe("GET /api/accounts", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await GET();

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns the user's connected accounts", async () => {
    mockAuthenticated();
    const fakeAccounts = [
      {
        id: "account-1",
        platform: "TWITTER",
        username: "testuser",
        expiresAt: null,
        createdAt: new Date("2025-01-01"),
      },
    ];
    prismaMock.socialAccount.findMany.mockResolvedValue(fakeAccounts as any);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].platform).toBe("TWITTER");
    expect(body[0].username).toBe("testuser");
  });

  it("filters accounts by the current user's id", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findMany.mockResolvedValue([]);

    await GET();

    expect(prismaMock.socialAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: mockSession.user.id },
      })
    );
  });

  it("never returns accessToken or refreshToken fields", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findMany.mockResolvedValue([
      { id: "acc-1", platform: "TWITTER", username: "user", expiresAt: null, createdAt: new Date() } as any,
    ]);

    const res = await GET();
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

  it("returns 404 when account belongs to a different user (IDOR prevention)", async () => {
    mockAuthenticated();
    prismaMock.socialAccount.findFirst.mockResolvedValue(null); // not found for this user

    const res = await DELETE(makeRequest("http://localhost/api/accounts?id=other-users-account"));

    expect(res.status).toBe(404);
    // Must check ownership in findFirst — verify the query includes userId
    expect(prismaMock.socialAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: mockSession.user.id }),
      })
    );
  });

  it("deletes the account and returns success when owned by current user", async () => {
    mockAuthenticated();
    const account = { id: "account-1", userId: mockSession.user.id };
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
