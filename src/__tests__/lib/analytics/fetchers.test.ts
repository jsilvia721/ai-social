import {
  fetchTwitterMetrics,
  fetchFacebookMetrics,
  fetchInstagramMetrics,
} from "@/lib/analytics/fetchers";

// ── helpers ─────────────────────────────────────────────────────────────────

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  return jest.spyOn(global, "fetch").mockResolvedValue(response as Response);
}

// ── fetchTwitterMetrics ──────────────────────────────────────────────────────

describe("fetchTwitterMetrics", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns mapped metrics on a successful response", async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        data: {
          public_metrics: {
            like_count: 10,
            reply_count: 5,
            retweet_count: 3,
            impression_count: 500,
          },
        },
      }),
    });

    const result = await fetchTwitterMetrics("token", "tweet-123");

    expect(result).toMatchObject({
      metricsLikes: 10,
      metricsComments: 5,
      metricsShares: 3,
      metricsImpressions: 500,
      metricsReach: null,
      metricsSaves: null,
    });
    expect(result?.metricsUpdatedAt).toBeInstanceOf(Date);
  });

  it("returns null impression_count when the field is missing (Basic API access)", async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        data: {
          public_metrics: { like_count: 10, reply_count: 5, retweet_count: 3 },
        },
      }),
    });

    const result = await fetchTwitterMetrics("token", "tweet-123");
    expect(result?.metricsImpressions).toBeNull();
  });

  it("sends the tweet ID in the URL and the Authorization header", async () => {
    const spy = mockFetch({
      ok: true,
      json: async () => ({
        data: { public_metrics: { like_count: 0, reply_count: 0, retweet_count: 0 } },
      }),
    });

    await fetchTwitterMetrics("my-token", "tweet-xyz");

    const [url, options] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("tweet-xyz");
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer my-token"
    );
  });

  it("returns null when the API response is not ok", async () => {
    mockFetch({ ok: false });
    expect(await fetchTwitterMetrics("token", "tweet-123")).toBeNull();
  });

  it("returns null when public_metrics is absent", async () => {
    mockFetch({ ok: true, json: async () => ({ data: {} }) });
    expect(await fetchTwitterMetrics("token", "tweet-123")).toBeNull();
  });

  it("returns null on fetch error without throwing", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));
    expect(await fetchTwitterMetrics("token", "tweet-123")).toBeNull();
  });
});

// ── fetchFacebookMetrics ─────────────────────────────────────────────────────

describe("fetchFacebookMetrics", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns mapped metrics on a successful response", async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        likes: { summary: { total_count: 20 } },
        comments: { summary: { total_count: 8 } },
        shares: { count: 4 },
        insights: {
          data: [{ name: "post_impressions", values: [{ value: 1000 }] }],
        },
      }),
    });

    const result = await fetchFacebookMetrics("token", "post-123");

    expect(result).toMatchObject({
      metricsLikes: 20,
      metricsComments: 8,
      metricsShares: 4,
      metricsImpressions: 1000,
      metricsReach: null,
      metricsSaves: null,
    });
    expect(result?.metricsUpdatedAt).toBeInstanceOf(Date);
  });

  it("returns null for all fields when the body is empty", async () => {
    mockFetch({ ok: true, json: async () => ({}) });

    const result = await fetchFacebookMetrics("token", "post-123");
    expect(result).toMatchObject({
      metricsLikes: null,
      metricsComments: null,
      metricsShares: null,
      metricsImpressions: null,
    });
  });

  it("returns null impressions when insights data array is empty", async () => {
    mockFetch({ ok: true, json: async () => ({ insights: { data: [] } }) });

    const result = await fetchFacebookMetrics("token", "post-123");
    expect(result?.metricsImpressions).toBeNull();
  });

  it("includes the post ID and access token in the URL", async () => {
    const spy = mockFetch({ ok: true, json: async () => ({}) });

    await fetchFacebookMetrics("fb-token-abc", "post-xyz");

    const [url] = spy.mock.calls[0] as [string];
    expect(url).toContain("post-xyz");
    expect(url).toContain("fb-token-abc");
  });

  it("returns null when the API response is not ok", async () => {
    mockFetch({ ok: false });
    expect(await fetchFacebookMetrics("token", "post-123")).toBeNull();
  });

  it("returns null on fetch error without throwing", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));
    expect(await fetchFacebookMetrics("token", "post-123")).toBeNull();
  });
});

// ── fetchInstagramMetrics ────────────────────────────────────────────────────

describe("fetchInstagramMetrics", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns mapped metrics on a successful response", async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        data: [
          { name: "likes", values: [{ value: 15 }] },
          { name: "comments", values: [{ value: 7 }] },
          { name: "impressions", values: [{ value: 800 }] },
          { name: "reach", values: [{ value: 600 }] },
          { name: "saves", values: [{ value: 25 }] },
        ],
      }),
    });

    const result = await fetchInstagramMetrics("token", "media-123");

    expect(result).toMatchObject({
      metricsLikes: 15,
      metricsComments: 7,
      metricsShares: null,
      metricsImpressions: 800,
      metricsReach: 600,
      metricsSaves: 25,
    });
    expect(result?.metricsUpdatedAt).toBeInstanceOf(Date);
  });

  it("always returns null for metricsShares (Instagram has no share metric)", async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        data: [{ name: "likes", values: [{ value: 5 }] }],
      }),
    });

    const result = await fetchInstagramMetrics("token", "media-123");
    expect(result?.metricsShares).toBeNull();
  });

  it("returns null for metrics that are absent from the response", async () => {
    mockFetch({ ok: true, json: async () => ({ data: [] }) });

    const result = await fetchInstagramMetrics("token", "media-123");
    expect(result).toMatchObject({
      metricsLikes: null,
      metricsComments: null,
      metricsImpressions: null,
      metricsReach: null,
      metricsSaves: null,
    });
  });

  it("includes the media ID and access token in the URL", async () => {
    const spy = mockFetch({ ok: true, json: async () => ({ data: [] }) });

    await fetchInstagramMetrics("ig-token", "media-456");

    const [url] = spy.mock.calls[0] as [string];
    expect(url).toContain("media-456");
    expect(url).toContain("ig-token");
  });

  it("returns null when the API response is not ok", async () => {
    mockFetch({ ok: false });
    expect(await fetchInstagramMetrics("token", "media-123")).toBeNull();
  });

  it("returns null on fetch error without throwing", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("Network error"));
    expect(await fetchInstagramMetrics("token", "media-123")).toBeNull();
  });
});
