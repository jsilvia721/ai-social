import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

jest.mock("next/headers", () => {
  const store = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
  return { cookies: jest.fn().mockResolvedValue(store), __store: store };
});

import { GET } from "@/app/api/connect/tiktok/callback/route";
import { NextRequest } from "next/server";

type CookieStore = { get: jest.Mock; set: jest.Mock; delete: jest.Mock };
const getCookieStore = (): CookieStore =>
  (jest.requireMock("next/headers") as { __store: CookieStore }).__store;

const VALID_STATE = "tiktok-state-abc";
const VALID_VERIFIER = "verifier123";
const VALID_COOKIE = JSON.stringify({ state: VALID_STATE, codeVerifier: VALID_VERIFIER });

function makeRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/connect/tiktok/callback");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

function getRedirectLocation(res: Response): string {
  return res.headers.get("location") ?? "";
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe("GET /api/connect/tiktok/callback", () => {
  it("redirects to /auth/signin when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET(makeRequest({ code: "code", state: VALID_STATE }));
    expect(getRedirectLocation(res)).toContain("/auth/signin");
  });

  it("redirects with error=tiktok_denied when error param is present", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({ error: "access_denied" }));
    expect(getRedirectLocation(res)).toContain("error=tiktok_denied");
  });

  it("redirects with error=tiktok_state_missing when no cookie exists", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue(undefined);
    const res = await GET(makeRequest({ code: "code", state: VALID_STATE }));
    expect(getRedirectLocation(res)).toContain("error=tiktok_state_missing");
  });

  it("redirects with error=tiktok_state_invalid when cookie is invalid JSON", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: "not-json" });
    const res = await GET(makeRequest({ code: "code", state: VALID_STATE }));
    expect(getRedirectLocation(res)).toContain("error=tiktok_state_invalid");
  });

  it("redirects with error=tiktok_state_mismatch when state does not match", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });
    const res = await GET(makeRequest({ code: "code", state: "wrong-state" }));
    expect(getRedirectLocation(res)).toContain("error=tiktok_state_mismatch");
  });

  it("redirects with error=tiktok_token_failed when token exchange fails", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      text: async () => "bad request",
    });

    const res = await GET(makeRequest({ code: "code", state: VALID_STATE }));
    expect(getRedirectLocation(res)).toContain("error=tiktok_token_failed");
  });

  it("upserts SocialAccount and redirects to success on happy path", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });
    // Token exchange
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "tiktok-at",
          refresh_token: "tiktok-rt",
          expires_in: 86400,
          open_id: "tiktok-open-id",
        }),
      })
      // User info
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { user: { display_name: "TikTokUser" } } }),
      });
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    const res = await GET(makeRequest({ code: "auth-code", state: VALID_STATE }));

    expect(prismaMock.socialAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platform_platformId: { platform: "TIKTOK", platformId: "tiktok-open-id" },
        },
        create: expect.objectContaining({
          userId: mockSession.user.id,
          platform: "TIKTOK",
          username: "TikTokUser",
          accessToken: "tiktok-at",
          refreshToken: "tiktok-rt",
        }),
      })
    );
    expect(getRedirectLocation(res)).toContain("success=tiktok_connected");
  });

  it("falls back to open_id as username when user info fetch fails", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 86400,
          open_id: "tiktok-open-id",
        }),
      })
      .mockResolvedValueOnce({ ok: false });
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    await GET(makeRequest({ code: "code", state: VALID_STATE }));

    const upsertCall = prismaMock.socialAccount.upsert.mock.calls[0][0];
    expect(upsertCall.create.username).toBe("tiktok-open-id");
  });

  it("sets expiresAt to null when expires_in is absent", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at", open_id: "oid" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { user: { display_name: "User" } } }),
      });
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    await GET(makeRequest({ code: "code", state: VALID_STATE }));

    const upsertCall = prismaMock.socialAccount.upsert.mock.calls[0][0];
    expect(upsertCall.create.expiresAt).toBeNull();
  });
});
