import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/blotato/accounts", () => ({
  getAccount: jest.fn(),
}));

import { GET } from "@/app/api/connect/blotato/callback/route";
import { NextRequest } from "next/server";
import { getAccount } from "@/lib/blotato/accounts";

const mockGetAccount = getAccount as jest.Mock;

function encodeState(data: { userId: string; businessId: string }) {
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/connect/blotato/callback");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

const validState = encodeState({ userId: mockSession.user.id, businessId: "biz-1" });

const fakeBlotatoAccount = {
  id: "blotato-acct-123",
  platform: "TWITTER",
  username: "testuser",
  platformId: "tw-123",
};

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("GET /api/connect/blotato/callback", () => {
  it("returns 400 when state param is missing", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({ accountId: "blotato-acct-123" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when accountId param is missing", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({ state: validState }));
    expect(res.status).toBe(400);
  });

  it("redirects to /auth/signin when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET(makeRequest({ state: validState, accountId: "blotato-acct-123" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/auth/signin");
  });

  it("returns 403 when state userId does not match session", async () => {
    mockAuthenticated();
    const mismatchedState = encodeState({ userId: "different-user-id", businessId: "biz-1" });
    const res = await GET(makeRequest({ state: mismatchedState, accountId: "blotato-acct-123" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when state is not valid base64url JSON", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({ state: "not-valid-base64!", accountId: "blotato-acct-123" }));
    expect(res.status).toBe(400);
  });

  it("upserts SocialAccount and redirects to /dashboard/accounts on success", async () => {
    mockAuthenticated();
    mockGetAccount.mockResolvedValue(fakeBlotatoAccount);
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    const res = await GET(makeRequest({ state: validState, accountId: "blotato-acct-123" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/dashboard\/accounts$/);
    expect(prismaMock.socialAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platform_platformId: {
            platform: "TWITTER",
            platformId: "tw-123",
          },
        },
        create: expect.objectContaining({
          businessId: "biz-1",
          blotatoAccountId: "blotato-acct-123",
          platform: "TWITTER",
          username: "testuser",
          platformId: "tw-123",
        }),
        update: expect.objectContaining({
          blotatoAccountId: "blotato-acct-123",
          username: "testuser",
        }),
      })
    );
  });

  it("uses platform from state if platformId is not returned by Blotato", async () => {
    mockAuthenticated();
    const stateWithPlatform = encodeState({
      userId: mockSession.user.id,
      businessId: "biz-1",
    });
    const accountWithoutPlatformId = { ...fakeBlotatoAccount, platformId: undefined };
    mockGetAccount.mockResolvedValue(accountWithoutPlatformId);
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    const res = await GET(makeRequest({ state: stateWithPlatform, accountId: "blotato-acct-123" }));

    expect(res.status).toBe(302);
    // platformId falls back to blotatoAccountId when Blotato doesn't provide one
    expect(prismaMock.socialAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platform_platformId: {
            platform: "TWITTER",
            platformId: "blotato-acct-123",
          },
        },
      })
    );
  });

  it("redirects to /dashboard/accounts?error=connect when Blotato API call fails", async () => {
    mockAuthenticated();
    mockGetAccount.mockRejectedValue(new Error("Blotato API error"));

    const res = await GET(makeRequest({ state: validState, accountId: "blotato-acct-123" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/dashboard\/accounts/);
    expect(res.headers.get("location")).toContain("error=connect");
    expect(prismaMock.socialAccount.upsert).not.toHaveBeenCalled();
  });
});
