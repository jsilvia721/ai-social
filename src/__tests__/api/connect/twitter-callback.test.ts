import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

jest.mock("next/headers", () => {
  const store = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
  return { cookies: jest.fn().mockResolvedValue(store), __store: store };
});

import { GET } from "@/app/api/connect/twitter/callback/route";
import { NextRequest } from "next/server";

type CookieStore = { get: jest.Mock; set: jest.Mock; delete: jest.Mock };
const getCookieStore = (): CookieStore =>
  (jest.requireMock("next/headers") as { __store: CookieStore }).__store;

const VALID_STATE = "abc123state";
const VALID_VERIFIER = "code_verifier_value";
const VALID_COOKIE = JSON.stringify({ state: VALID_STATE, codeVerifier: VALID_VERIFIER });

function makeRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/connect/twitter/callback");
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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GET /api/connect/twitter/callback", () => {
  it("redirects to /auth/signin when not authenticated", async () => {
    mockUnauthenticated();

    const res = await GET(makeRequest({ code: "code", state: VALID_STATE }));

    expect(getRedirectLocation(res)).toContain("/auth/signin");
  });

  it("redirects with error=twitter_denied when error param is present", async () => {
    mockAuthenticated();

    const res = await GET(makeRequest({ error: "access_denied" }));

    expect(getRedirectLocation(res)).toContain("error=twitter_denied");
  });

  it("redirects with error=state_missing when no state cookie exists", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue(undefined);

    const res = await GET(makeRequest({ code: "code", state: VALID_STATE }));

    expect(getRedirectLocation(res)).toContain("error=state_missing");
  });

  it("redirects with error=state_mismatch when state param does not match cookie", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });

    const res = await GET(makeRequest({ code: "code", state: "wrong-state" }));

    expect(getRedirectLocation(res)).toContain("error=state_mismatch");
  });

  it("deletes the state cookie after state validates (before the external API call)", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });
    // Token exchange fails — but state was valid, so cookie should be deleted before this point
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "invalid_grant" }),
    });

    await GET(makeRequest({ code: "code", state: VALID_STATE }));

    expect(getCookieStore().delete).toHaveBeenCalledWith("twitter_oauth_state");
  });

  it("redirects with error=token_exchange_failed when Twitter token endpoint fails", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "invalid_grant" }),
    });

    const res = await GET(makeRequest({ code: "auth-code", state: VALID_STATE }));

    expect(getRedirectLocation(res)).toContain("error=token_exchange_failed");
  });

  it("redirects with error=user_fetch_failed when Twitter /users/me fails", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ title: "Unauthorized" }),
      });

    const res = await GET(makeRequest({ code: "auth-code", state: VALID_STATE }));

    expect(getRedirectLocation(res)).toContain("error=user_fetch_failed");
  });

  it("upserts SocialAccount and redirects to success on happy path", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at-token", refresh_token: "rt-token", expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "twitter-user-id", username: "testuser" } }),
      });
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    const res = await GET(makeRequest({ code: "auth-code", state: VALID_STATE }));

    expect(prismaMock.socialAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platform_platformId: { platform: "TWITTER", platformId: "twitter-user-id" },
        },
        create: expect.objectContaining({
          userId: mockSession.user.id,
          platform: "TWITTER",
          username: "testuser",
          accessToken: "at-token",
          refreshToken: "rt-token",
        }),
      })
    );
    expect(getRedirectLocation(res)).toContain("success=twitter_connected");
  });

  it("sets expiresAt correctly when expires_in is present", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });
    const beforeCall = Date.now();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at", refresh_token: null, expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tw-id", username: "user" } }),
      });
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    await GET(makeRequest({ code: "code", state: VALID_STATE }));

    const upsertCall = prismaMock.socialAccount.upsert.mock.calls[0][0];
    const expiresAt = upsertCall.create.expiresAt as Date;
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(beforeCall + 3600 * 1000);
  });

  it("sets expiresAt to null when expires_in is absent", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_COOKIE });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at", refresh_token: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "tw-id", username: "user" } }),
      });
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    await GET(makeRequest({ code: "code", state: VALID_STATE }));

    const upsertCall = prismaMock.socialAccount.upsert.mock.calls[0][0];
    expect(upsertCall.create.expiresAt).toBeNull();
  });
});
