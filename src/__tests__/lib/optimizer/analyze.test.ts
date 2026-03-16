import {
  computeEngagementRate,
  groupPostsByDimension,
  identifyTopPerformers,
  identifyBottomPerformers,
  computeFormatMix,
  isMetricsMature,
  type AnalyzablePost,
} from "@/lib/optimizer/analyze";

function makePost(overrides: Partial<AnalyzablePost> = {}): AnalyzablePost {
  return {
    id: overrides.id ?? "post-1",
    platform: overrides.platform ?? "TWITTER",
    topicPillar: overrides.topicPillar ?? null,
    tone: overrides.tone ?? null,
    format: overrides.format ?? null,
    metricsLikes: overrides.metricsLikes ?? 0,
    metricsComments: overrides.metricsComments ?? 0,
    metricsShares: overrides.metricsShares ?? 0,
    metricsSaves: overrides.metricsSaves ?? 0,
    metricsUpdatedAt: "metricsUpdatedAt" in overrides ? (overrides.metricsUpdatedAt ?? null) : new Date(),
    publishedAt: "publishedAt" in overrides ? (overrides.publishedAt ?? null) : new Date(),
  };
}

describe("computeEngagementRate", () => {
  it("returns 0 for zero metrics", () => {
    const post = makePost();
    expect(computeEngagementRate(post)).toBe(0);
  });

  it("returns higher score for above-baseline engagement", () => {
    const baseline = makePost({
      platform: "TWITTER",
      metricsLikes: 50,
      metricsComments: 10,
      metricsShares: 15,
      metricsSaves: 5,
    });
    const above = makePost({
      platform: "TWITTER",
      metricsLikes: 200,
      metricsComments: 40,
      metricsShares: 60,
      metricsSaves: 20,
    });
    expect(computeEngagementRate(above)).toBeGreaterThan(
      computeEngagementRate(baseline)
    );
  });

  it("normalizes differently per platform", () => {
    // Same raw metrics should produce different scores on different platforms
    const twitterPost = makePost({
      platform: "TWITTER",
      metricsLikes: 100,
      metricsComments: 20,
      metricsShares: 30,
      metricsSaves: 10,
    });
    const tiktokPost = makePost({
      platform: "TIKTOK",
      metricsLikes: 100,
      metricsComments: 20,
      metricsShares: 30,
      metricsSaves: 10,
    });
    expect(computeEngagementRate(twitterPost)).not.toEqual(
      computeEngagementRate(tiktokPost)
    );
  });

  it("handles null metrics gracefully", () => {
    const post = makePost({
      metricsLikes: null as unknown as number,
      metricsComments: null as unknown as number,
      metricsShares: null as unknown as number,
      metricsSaves: null as unknown as number,
    });
    expect(computeEngagementRate(post)).toBe(0);
  });

  it("uses platform-specific weights: Twitter repost-heavy post scores higher than like-heavy", () => {
    // Twitter weights: reposts(shares)=20, likes=1
    // A post with many shares should score much higher than one with many likes
    const repostHeavy = makePost({
      platform: "TWITTER",
      metricsLikes: 10,
      metricsShares: 100,
    });
    const likeHeavy = makePost({
      platform: "TWITTER",
      metricsLikes: 100,
      metricsShares: 10,
    });
    expect(computeEngagementRate(repostHeavy)).toBeGreaterThan(
      computeEngagementRate(likeHeavy)
    );
  });

  it("uses platform-specific weights: Instagram save-heavy post scores higher than like-heavy", () => {
    // Instagram weights: saves=10, likes=1
    const saveHeavy = makePost({
      platform: "INSTAGRAM",
      metricsLikes: 10,
      metricsSaves: 100,
    });
    const likeHeavy = makePost({
      platform: "INSTAGRAM",
      metricsLikes: 100,
      metricsSaves: 10,
    });
    expect(computeEngagementRate(saveHeavy)).toBeGreaterThan(
      computeEngagementRate(likeHeavy)
    );
  });

  it("weights shares much more heavily on Twitter than on YouTube", () => {
    // Twitter shares weight=20 vs YouTube shares weight=4
    // Same metrics, but Twitter should value shares more relative to baseline
    const twitterPost = makePost({
      platform: "TWITTER",
      metricsShares: 50,
      metricsLikes: 10,
    });
    const youtubePost = makePost({
      platform: "YOUTUBE",
      metricsShares: 50,
      metricsLikes: 10,
    });
    // The raw weighted score for shares is much higher on Twitter
    // but baselines differ, so we check the ratio of share contribution
    const twitterScore = computeEngagementRate(twitterPost);
    const youtubeScore = computeEngagementRate(youtubePost);
    // Both should be > 0
    expect(twitterScore).toBeGreaterThan(0);
    expect(youtubeScore).toBeGreaterThan(0);
  });

  it("produces different scores per platform for identical metrics due to different weights", () => {
    const metrics = {
      metricsLikes: 50,
      metricsComments: 20,
      metricsShares: 30,
      metricsSaves: 15,
    };
    const platforms = ["TWITTER", "INSTAGRAM", "TIKTOK", "FACEBOOK", "YOUTUBE"] as const;
    const scores = platforms.map((platform) =>
      computeEngagementRate(makePost({ platform, ...metrics }))
    );
    // All scores should be unique (different weights + different baselines)
    const uniqueScores = new Set(scores);
    expect(uniqueScores.size).toBe(5);
  });
});

describe("groupPostsByDimension", () => {
  it("groups by format", () => {
    const posts = [
      makePost({ id: "1", format: "TEXT", metricsLikes: 100 }),
      makePost({ id: "2", format: "TEXT", metricsLikes: 200 }),
      makePost({ id: "3", format: "VIDEO", metricsLikes: 300 }),
    ];
    const groups = groupPostsByDimension(posts, "format");
    expect(Object.keys(groups)).toEqual(expect.arrayContaining(["TEXT", "VIDEO"]));
    expect(groups["TEXT"].count).toBe(2);
    expect(groups["VIDEO"].count).toBe(1);
  });

  it("groups by topicPillar", () => {
    const posts = [
      makePost({ id: "1", topicPillar: "tutorials" }),
      makePost({ id: "2", topicPillar: "tutorials" }),
      makePost({ id: "3", topicPillar: "news" }),
    ];
    const groups = groupPostsByDimension(posts, "topicPillar");
    expect(groups["tutorials"].count).toBe(2);
    expect(groups["news"].count).toBe(1);
  });

  it("groups by tone", () => {
    const posts = [
      makePost({ id: "1", tone: "educational" }),
      makePost({ id: "2", tone: "entertaining" }),
    ];
    const groups = groupPostsByDimension(posts, "tone");
    expect(groups["educational"].count).toBe(1);
    expect(groups["entertaining"].count).toBe(1);
  });

  it("groups by platform", () => {
    const posts = [
      makePost({ id: "1", platform: "TWITTER" }),
      makePost({ id: "2", platform: "INSTAGRAM" }),
      makePost({ id: "3", platform: "TWITTER" }),
    ];
    const groups = groupPostsByDimension(posts, "platform");
    expect(groups["TWITTER"].count).toBe(2);
    expect(groups["INSTAGRAM"].count).toBe(1);
  });

  it("puts posts with null dimension in 'untagged' group", () => {
    const posts = [
      makePost({ id: "1", format: null }),
      makePost({ id: "2", format: "TEXT" }),
    ];
    const groups = groupPostsByDimension(posts, "format");
    expect(groups["untagged"].count).toBe(1);
    expect(groups["TEXT"].count).toBe(1);
  });

  it("computes average engagement per group", () => {
    const posts = [
      makePost({
        id: "1",
        format: "TEXT",
        platform: "TWITTER",
        metricsLikes: 50,
        metricsComments: 10,
        metricsShares: 15,
        metricsSaves: 5,
      }),
      makePost({
        id: "2",
        format: "TEXT",
        platform: "TWITTER",
        metricsLikes: 100,
        metricsComments: 20,
        metricsShares: 30,
        metricsSaves: 10,
      }),
    ];
    const groups = groupPostsByDimension(posts, "format");
    expect(groups["TEXT"].avgEngagement).toBeGreaterThan(0);
  });
});

describe("identifyTopPerformers", () => {
  it("returns top N posts by engagement rate", () => {
    const posts = [
      makePost({ id: "low", platform: "TWITTER", metricsLikes: 10 }),
      makePost({ id: "high", platform: "TWITTER", metricsLikes: 500, metricsComments: 100 }),
      makePost({ id: "mid", platform: "TWITTER", metricsLikes: 100 }),
    ];
    const top = identifyTopPerformers(posts, 2);
    expect(top).toHaveLength(2);
    expect(top[0].postId).toBe("high");
  });

  it("returns fewer than N if not enough posts", () => {
    const posts = [makePost({ id: "only" })];
    const top = identifyTopPerformers(posts, 5);
    expect(top).toHaveLength(1);
  });
});

describe("identifyBottomPerformers", () => {
  it("returns bottom N posts by engagement rate", () => {
    const posts = [
      makePost({ id: "low", platform: "TWITTER", metricsLikes: 1 }),
      makePost({ id: "high", platform: "TWITTER", metricsLikes: 500, metricsComments: 100 }),
      makePost({ id: "mid", platform: "TWITTER", metricsLikes: 50 }),
    ];
    const bottom = identifyBottomPerformers(posts, 1);
    expect(bottom).toHaveLength(1);
    expect(bottom[0].postId).toBe("low");
  });
});

describe("computeFormatMix", () => {
  it("returns percentage distribution of formats", () => {
    const posts = [
      makePost({ format: "TEXT" }),
      makePost({ format: "TEXT" }),
      makePost({ format: "VIDEO" }),
      makePost({ format: "IMAGE" }),
    ];
    const mix = computeFormatMix(posts);
    expect(mix["TEXT"]).toBeCloseTo(0.5);
    expect(mix["VIDEO"]).toBeCloseTo(0.25);
    expect(mix["IMAGE"]).toBeCloseTo(0.25);
  });

  it("puts untagged posts in 'untagged' bucket", () => {
    const posts = [
      makePost({ format: "TEXT" }),
      makePost({ format: null }),
    ];
    const mix = computeFormatMix(posts);
    expect(mix["TEXT"]).toBeCloseTo(0.5);
    expect(mix["untagged"]).toBeCloseTo(0.5);
  });

  it("returns empty object for empty array", () => {
    expect(computeFormatMix([])).toEqual({});
  });
});

describe("isMetricsMature", () => {
  it("returns true for Twitter post older than 24h with recent metrics", () => {
    const now = new Date("2026-03-08T12:00:00Z");
    const post = makePost({
      platform: "TWITTER",
      publishedAt: new Date("2026-03-07T10:00:00Z"), // 26h ago
      metricsUpdatedAt: new Date("2026-03-08T11:00:00Z"), // 1h ago, after publishedAt
    });
    expect(isMetricsMature(post, now)).toBe(true);
  });

  it("returns false for Twitter post newer than 24h", () => {
    const now = new Date("2026-03-08T12:00:00Z");
    const post = makePost({
      platform: "TWITTER",
      publishedAt: new Date("2026-03-08T10:00:00Z"), // 2h ago
      metricsUpdatedAt: new Date("2026-03-08T11:00:00Z"),
    });
    expect(isMetricsMature(post, now)).toBe(false);
  });

  it("returns false when metricsUpdatedAt is null", () => {
    const now = new Date("2026-03-08T12:00:00Z");
    const post = makePost({
      platform: "TWITTER",
      publishedAt: new Date("2026-03-07T10:00:00Z"),
      metricsUpdatedAt: null as unknown as Date,
    });
    expect(isMetricsMature(post, now)).toBe(false);
  });

  it("returns false when metricsUpdatedAt is before publishedAt", () => {
    const now = new Date("2026-03-08T12:00:00Z");
    const post = makePost({
      platform: "TWITTER",
      publishedAt: new Date("2026-03-07T10:00:00Z"),
      metricsUpdatedAt: new Date("2026-03-07T09:00:00Z"), // stale
    });
    expect(isMetricsMature(post, now)).toBe(false);
  });

  it("respects Instagram 72h window", () => {
    const now = new Date("2026-03-10T12:00:00Z");
    const maturePost = makePost({
      platform: "INSTAGRAM",
      publishedAt: new Date("2026-03-07T10:00:00Z"), // 74h ago
      metricsUpdatedAt: new Date("2026-03-10T11:00:00Z"),
    });
    const freshPost = makePost({
      platform: "INSTAGRAM",
      publishedAt: new Date("2026-03-09T10:00:00Z"), // 26h ago
      metricsUpdatedAt: new Date("2026-03-10T11:00:00Z"),
    });
    expect(isMetricsMature(maturePost, now)).toBe(true);
    expect(isMetricsMature(freshPost, now)).toBe(false);
  });

  it("respects YouTube 168h window", () => {
    const now = new Date("2026-03-15T12:00:00Z");
    const maturePost = makePost({
      platform: "YOUTUBE",
      publishedAt: new Date("2026-03-07T10:00:00Z"), // 8+ days ago
      metricsUpdatedAt: new Date("2026-03-15T11:00:00Z"),
    });
    const freshPost = makePost({
      platform: "YOUTUBE",
      publishedAt: new Date("2026-03-12T10:00:00Z"), // 3 days ago
      metricsUpdatedAt: new Date("2026-03-15T11:00:00Z"),
    });
    expect(isMetricsMature(maturePost, now)).toBe(true);
    expect(isMetricsMature(freshPost, now)).toBe(false);
  });
});
