import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/crypto", () => ({
  encryptToken: (s: string) => s,
  decryptToken: (s: string) => s,
}));

jest.mock("next/headers", () => {
  const store = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
  return { cookies: jest.fn().mockResolvedValue(store), __store: store };
});

import { GET } from "@/app/api/connect/youtube/callback/route";
import { NextRequest } from "next/server";

type CookieStore = { get: jest.Mock; set: jest.Mock; delete: jest.Mock };
const getCookieStore = (): CookieStore =>
  (jest.requireMock("next/headers") as { __store: CookieStore }).__store;

const VALID_STATE = "yt-state-xyz";

function makeRequest(params: Record<string, string>) {
  const url = new URL("http://localhost/api/connect/youtube/callback");
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

describe("GET /api/connect/youtube/callback", () => {
  it("redirects to /auth/signin when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET(makeRequest({ code: "code", state: VALID_STATE }));
    expect(getRedirectLocation(res)).toContain("/auth/signin");
  });

  it("redirects with error=youtube_denied when error param is present", async () => {
    mockAuthenticated();
    const res = await GET(makeRequest({ error: "access_denied" }));
    expect(getRedirectLocation(res)).toContain("error=youtube_denied");
  });

  it("redirects with error=youtube_state_mismatch when state does not match", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_STATE });
    const res = await GET(makeRequest({ code: "code", state: "wrong-state" }));
    expect(getRedirectLocation(res)).toContain("error=youtube_state_mismatch");
  });

  it("redirects with error=youtube_token_failed when Google token exchange fails", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_STATE });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      text: async () => "error",
    });
    const res = await GET(makeRequest({ code: "code", state: VALID_STATE }));
    expect(getRedirectLocation(res)).toContain("error=youtube_token_failed");
  });

  it("redirects with error=youtube_channel_failed when channels API fails", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_STATE });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: false, text: async () => "error" });
    const res = await GET(makeRequest({ code: "code", state: VALID_STATE }));
    expect(getRedirectLocation(res)).toContain("error=youtube_channel_failed");
  });

  it("redirects with error=youtube_no_channel when no channel returned", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_STATE });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [] }),
      });
    const res = await GET(makeRequest({ code: "code", state: VALID_STATE }));
    expect(getRedirectLocation(res)).toContain("error=youtube_no_channel");
  });

  it("upserts SocialAccount with YOUTUBE platform and redirects to success", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_STATE });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "yt-at", refresh_token: "yt-rt", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [{ id: "channel-id-123", snippet: { title: "My Channel" } }],
        }),
      });
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    const res = await GET(makeRequest({ code: "auth-code", state: VALID_STATE }));

    expect(prismaMock.socialAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platform_platformId: { platform: "YOUTUBE", platformId: "channel-id-123" },
        },
        create: expect.objectContaining({
          userId: mockSession.user.id,
          platform: "YOUTUBE",
          username: "My Channel",
          accessToken: "yt-at",
          refreshToken: "yt-rt",
        }),
      })
    );
    expect(getRedirectLocation(res)).toContain("success=youtube_connected");
  });

  it("falls back to channel ID as username when snippet.title is missing", async () => {
    mockAuthenticated();
    getCookieStore().get.mockReturnValue({ value: VALID_STATE });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "at", refresh_token: "rt", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ items: [{ id: "ch-456", snippet: {} }] }),
      });
    prismaMock.socialAccount.upsert.mockResolvedValue({} as any);

    await GET(makeRequest({ code: "code", state: VALID_STATE }));

    const upsertCall = prismaMock.socialAccount.upsert.mock.calls[0][0];
    expect(upsertCall.create.username).toBe("ch-456");
  });
});
