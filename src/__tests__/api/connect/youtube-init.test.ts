import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

jest.mock("next/headers", () => {
  const store = { set: jest.fn(), get: jest.fn(), delete: jest.fn() };
  return { cookies: jest.fn().mockResolvedValue(store), __store: store };
});

import { GET } from "@/app/api/connect/youtube/route";

const getCookieStore = () =>
  (jest.requireMock("next/headers") as { __store: { set: jest.Mock; get: jest.Mock; delete: jest.Mock } }).__store;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/connect/youtube", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("redirects to Google accounts.google.com OAuth endpoint", async () => {
    mockAuthenticated();
    const res = await GET();
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get("location");
    expect(location).toContain("accounts.google.com/o/oauth2/v2/auth");
  });

  it("includes youtube.upload scope in the redirect", async () => {
    mockAuthenticated();
    const res = await GET();
    const url = new URL(res.headers.get("location")!);
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("youtube.upload");
    expect(scope).toContain("youtube.readonly");
  });

  it("requests offline access to receive a refresh token", async () => {
    mockAuthenticated();
    const res = await GET();
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("access_type")).toBe("offline");
  });

  it("uses prompt=consent to force refresh token issuance", async () => {
    mockAuthenticated();
    const res = await GET();
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("sets httpOnly state cookie with 5-minute TTL", async () => {
    mockAuthenticated();
    await GET();
    const { set } = getCookieStore();
    expect(set).toHaveBeenCalledWith(
      "youtube_oauth_state",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "lax", maxAge: 300 })
    );
  });

  it("uses existing GOOGLE_CLIENT_ID for YouTube OAuth", async () => {
    mockAuthenticated();
    const res = await GET();
    const url = new URL(res.headers.get("location")!);
    expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
  });
});
