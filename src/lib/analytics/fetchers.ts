import { shouldMockExternalApis } from "@/lib/mocks/config";
import {
  mockFetchTwitterMetrics,
  mockFetchFacebookMetrics,
  mockFetchTikTokMetrics,
  mockFetchYouTubeMetrics,
  mockFetchInstagramMetrics,
} from "@/lib/mocks/fetchers";

const TIKTOK_VIDEO_URL = "https://open.tiktokapis.com/v2/video/query/";

export interface FetchedMetrics {
  metricsLikes: number | null;
  metricsComments: number | null;
  metricsShares: number | null;
  metricsImpressions: number | null;
  metricsReach: number | null;
  metricsSaves: number | null;
  metricsUpdatedAt: Date;
}

export async function fetchTwitterMetrics(
  accessToken: string,
  tweetId: string
): Promise<FetchedMetrics | null> {
  if (shouldMockExternalApis()) return mockFetchTwitterMetrics();
  try {
    const res = await fetch(
      `https://api.twitter.com/2/tweets/${tweetId}?tweet.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const m = json?.data?.public_metrics;
    if (!m) return null;
    return {
      metricsLikes: m.like_count ?? null,
      metricsComments: m.reply_count ?? null,
      metricsShares: m.retweet_count ?? null,
      metricsImpressions: m.impression_count ?? null,
      metricsReach: null,
      metricsSaves: null,
      metricsUpdatedAt: new Date(),
    };
  } catch {
    return null;
  }
}

export async function fetchFacebookMetrics(
  accessToken: string,
  postId: string
): Promise<FetchedMetrics | null> {
  if (shouldMockExternalApis()) return mockFetchFacebookMetrics();
  try {
    const url = new URL(`https://graph.facebook.com/v19.0/${postId}`);
    url.searchParams.set(
      "fields",
      "likes.summary(true),comments.summary(true),shares,insights.metric(post_impressions)"
    );
    url.searchParams.set("access_token", accessToken);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = await res.json();

    const likes = json?.likes?.summary?.total_count ?? null;
    const comments = json?.comments?.summary?.total_count ?? null;
    const shares = json?.shares?.count ?? null;

    let impressions: number | null = null;
    const insightData: { name: string; values: { value: number }[] }[] =
      json?.insights?.data ?? [];
    const impressionEntry = insightData.find((d) => d.name === "post_impressions");
    if (impressionEntry?.values?.[0]?.value !== undefined) {
      impressions = impressionEntry.values[0].value;
    }

    return {
      metricsLikes: likes,
      metricsComments: comments,
      metricsShares: shares,
      metricsImpressions: impressions,
      metricsReach: null,
      metricsSaves: null,
      metricsUpdatedAt: new Date(),
    };
  } catch {
    return null;
  }
}

export async function fetchTikTokMetrics(
  accessToken: string,
  publishId: string
): Promise<FetchedMetrics | null> {
  if (shouldMockExternalApis()) return mockFetchTikTokMetrics();
  try {
    const res = await fetch(
      `${TIKTOK_VIDEO_URL}?fields=like_count,comment_count,share_count,view_count`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filters: { video_ids: [publishId] } }),
      }
    );
    if (!res.ok) return null;
    const json = await res.json();
    const video = json?.data?.videos?.[0];
    if (!video) return null;
    return {
      metricsLikes: video.like_count ?? null,
      metricsComments: video.comment_count ?? null,
      metricsShares: video.share_count ?? null,
      metricsImpressions: video.view_count ?? null,
      metricsReach: null,
      metricsSaves: null,
      metricsUpdatedAt: new Date(),
    };
  } catch {
    return null;
  }
}

export async function fetchYouTubeMetrics(
  accessToken: string,
  videoId: string
): Promise<FetchedMetrics | null> {
  if (shouldMockExternalApis()) return mockFetchYouTubeMetrics();
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", videoId);
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const stats = json?.items?.[0]?.statistics;
    if (!stats) return null;
    return {
      metricsLikes: stats.likeCount ? parseInt(stats.likeCount, 10) : null,
      metricsComments: stats.commentCount ? parseInt(stats.commentCount, 10) : null,
      metricsShares: null,
      metricsImpressions: stats.viewCount ? parseInt(stats.viewCount, 10) : null,
      metricsReach: null,
      metricsSaves: null,
      metricsUpdatedAt: new Date(),
    };
  } catch {
    return null;
  }
}

export async function fetchInstagramMetrics(
  accessToken: string,
  mediaId: string
): Promise<FetchedMetrics | null> {
  if (shouldMockExternalApis()) return mockFetchInstagramMetrics();
  try {
    const url = new URL(`https://graph.facebook.com/v19.0/${mediaId}/insights`);
    url.searchParams.set("metric", "impressions,reach,likes,comments,saves");
    url.searchParams.set("access_token", accessToken);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const json = await res.json();

    const data: { name: string; values: { value: number }[] }[] = json?.data ?? [];
    const byName: Record<string, number | null> = {};
    for (const entry of data) {
      byName[entry.name] = entry.values?.[0]?.value ?? null;
    }

    return {
      metricsLikes: byName["likes"] ?? null,
      metricsComments: byName["comments"] ?? null,
      metricsShares: null,
      metricsImpressions: byName["impressions"] ?? null,
      metricsReach: byName["reach"] ?? null,
      metricsSaves: byName["saves"] ?? null,
      metricsUpdatedAt: new Date(),
    };
  } catch {
    return null;
  }
}
