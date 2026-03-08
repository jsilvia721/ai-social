/**
 * Mock data for social media platform metric fetchers.
 * Returns realistic engagement numbers without hitting platform APIs.
 */
import type { FetchedMetrics } from "@/lib/analytics/fetchers";

function mockMetrics(overrides: Partial<FetchedMetrics> = {}): FetchedMetrics {
  return {
    metricsLikes: Math.floor(Math.random() * 500) + 10,
    metricsComments: Math.floor(Math.random() * 50) + 2,
    metricsShares: Math.floor(Math.random() * 100) + 5,
    metricsImpressions: Math.floor(Math.random() * 10000) + 500,
    metricsReach: null,
    metricsSaves: null,
    metricsUpdatedAt: new Date(),
    ...overrides,
  };
}

export function mockFetchTwitterMetrics(): FetchedMetrics {
  return mockMetrics();
}

export function mockFetchFacebookMetrics(): FetchedMetrics {
  return mockMetrics();
}

export function mockFetchTikTokMetrics(): FetchedMetrics {
  return mockMetrics();
}

export function mockFetchYouTubeMetrics(): FetchedMetrics {
  return mockMetrics({ metricsShares: null });
}

export function mockFetchInstagramMetrics(): FetchedMetrics {
  return mockMetrics({
    metricsReach: Math.floor(Math.random() * 8000) + 300,
    metricsSaves: Math.floor(Math.random() * 30) + 1,
    metricsShares: null,
  });
}
