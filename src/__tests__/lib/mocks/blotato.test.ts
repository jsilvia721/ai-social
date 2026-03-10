import {
  mockGetConnectUrl,
  mockListAccounts,
  mockGetAccount,
  mockPublishPost,
  mockGetPostMetrics,
} from "@/lib/mocks/blotato";

describe("Blotato mock data", () => {
  it("mockGetConnectUrl returns a URL with the platform", () => {
    const result = mockGetConnectUrl("TWITTER");
    expect(result.url).toContain("TWITTER");
    expect(result.url).toContain("mock");
  });

  it("mockListAccounts returns multiple accounts", () => {
    const accounts = mockListAccounts();
    expect(accounts.length).toBeGreaterThanOrEqual(1);
    for (const account of accounts) {
      expect(account.id).toBeTruthy();
      expect(account.platform).toBeTruthy();
      expect(account.username).toBeTruthy();
    }
  });

  it("mockGetAccount returns matching account when ID matches", () => {
    const account = mockGetAccount("mock-twitter-001");
    expect(account.id).toBe("mock-twitter-001");
    expect(account.platform).toBe("TWITTER");
  });

  it("mockGetAccount returns fallback for unknown ID", () => {
    const account = mockGetAccount("unknown-id");
    expect(account.id).toBe("unknown-id");
  });

  it("mockPublishPost returns a blotatoPostId", () => {
    const result = mockPublishPost();
    expect(result.blotatoPostId).toContain("mock-post-");
  });

  it("mockGetPostMetrics returns numeric metrics", () => {
    const metrics = mockGetPostMetrics();
    expect(typeof metrics.likes).toBe("number");
    expect(typeof metrics.comments).toBe("number");
    expect(typeof metrics.shares).toBe("number");
    expect(typeof metrics.impressions).toBe("number");
    expect(typeof metrics.reach).toBe("number");
    expect(typeof metrics.saves).toBe("number");
  });
});
