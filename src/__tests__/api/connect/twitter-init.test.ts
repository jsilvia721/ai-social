import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

// Define cookie store inside the factory to avoid hoisting issues.
// Expose it on the mock module so tests can access and control it per-test.
jest.mock("next/headers", () => {
  const store = { set: jest.fn(), get: jest.fn(), delete: jest.fn() };
  return { cookies: jest.fn().mockResolvedValue(store), __store: store };
});

import { GET } from "@/app/api/connect/twitter/route";

const getCookieStore = () =>
  (jest.requireMock("next/headers") as { __store: { set: jest.Mock; get: jest.Mock; delete: jest.Mock } }).__store;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/connect/twitter", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await GET();

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("redirects to twitter.com/i/oauth2/authorize when authenticated", async () => {
    mockAuthenticated();

    const res = await GET();

    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    const location = res.headers.get("location");
    expect(location).toContain("twitter.com/i/oauth2/authorize");
  });

  it("includes the Twitter client_id in the redirect URL", async () => {
    mockAuthenticated();

    const res = await GET();

    const location = res.headers.get("location")!;
    const url = new URL(location);
    expect(url.searchParams.get("client_id")).toBe("test-twitter-client-id");
  });

  it("uses S256 as the code_challenge_method", async () => {
    mockAuthenticated();

    const res = await GET();

    const location = res.headers.get("location")!;
    const url = new URL(location);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("requests the required Twitter scopes", async () => {
    mockAuthenticated();

    const res = await GET();

    const location = res.headers.get("location")!;
    const url = new URL(location);
    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("tweet.read");
    expect(scope).toContain("tweet.write");
    expect(scope).toContain("users.read");
    expect(scope).toContain("offline.access");
  });

  it("sets the state cookie with security attributes", async () => {
    mockAuthenticated();

    await GET();

    const { set } = getCookieStore();
    expect(set).toHaveBeenCalledWith(
      "twitter_oauth_state",
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        maxAge: 300,
      })
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
    expect(typeof parsed.state).toBe("string");
    expect(typeof parsed.codeVerifier).toBe("string");
  });
});
