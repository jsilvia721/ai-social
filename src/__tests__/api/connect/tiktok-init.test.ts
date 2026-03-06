import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

jest.mock("next/headers", () => {
  const store = { set: jest.fn(), get: jest.fn(), delete: jest.fn() };
  return { cookies: jest.fn().mockResolvedValue(store), __store: store };
});

import { GET } from "@/app/api/connect/tiktok/route";

const getCookieStore = () =>
  (jest.requireMock("next/headers") as { __store: { set: jest.Mock; get: jest.Mock; delete: jest.Mock } }).__store;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/connect/tiktok", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("redirects to tiktok.com v2 authorize endpoint when authenticated", async () => {
    mockAuthenticated();
    const res = await GET();
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get("location");
    expect(location).toContain("tiktok.com/v2/auth/authorize");
  });

  it("includes TikTok client_key in the redirect URL", async () => {
    mockAuthenticated();
    const res = await GET();
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("client_key")).toBe("test-tiktok-client-id");
  });

  it("uses S256 as the code_challenge_method", async () => {
    mockAuthenticated();
    const res = await GET();
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("requests video.publish, video.upload, and user.info.basic scopes", async () => {
    mockAuthenticated();
    const res = await GET();
    const url = new URL(res.headers.get("location")!);
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("video.publish");
    expect(scope).toContain("video.upload");
    expect(scope).toContain("user.info.basic");
  });

  it("sets httpOnly state cookie with 5-minute TTL", async () => {
    mockAuthenticated();
    await GET();
    const { set } = getCookieStore();
    expect(set).toHaveBeenCalledWith(
      "tiktok_oauth_state",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 300 })
    );
  });

  it("stores both state and codeVerifier in the cookie", async () => {
    mockAuthenticated();
    await GET();
    const { set } = getCookieStore();
    const [, cookieValue] = set.mock.calls[0] as [string, string, object];
    const parsed = JSON.parse(cookieValue);
    expect(parsed).toHaveProperty("state");
    expect(parsed).toHaveProperty("codeVerifier");
  });
});
