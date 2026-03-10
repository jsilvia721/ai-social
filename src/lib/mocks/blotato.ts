/**
 * Mock data for Blotato API calls.
 * Returns realistic responses without hitting the Blotato API.
 */
import type { BlotatoAccount, BlotatoPostMetrics } from "@/lib/blotato/types";
import { randomUUID } from "crypto";

export function mockGetConnectUrl(platform: string): { url: string } {
  return {
    url: `https://app.blotato.com/mock-connect?platform=${platform}&mock=true`,
  };
}

export function mockListAccounts(): BlotatoAccount[] {
  return [
    { id: "mock-twitter-001", platform: "TWITTER", username: "mock_twitter_user", platformId: "tw_123" },
    { id: "mock-instagram-001", platform: "INSTAGRAM", username: "mock_insta_user", platformId: "ig_456" },
    { id: "mock-facebook-001", platform: "FACEBOOK", username: "Mock Facebook Page", platformId: "fb_789" },
  ];
}

export function mockGetAccount(id: string): BlotatoAccount {
  const accounts = mockListAccounts();
  return accounts.find((a) => a.id === id) ?? {
    id,
    platform: "TWITTER",
    username: "mock_user",
    platformId: `mock_${id}`,
  };
}

export function mockPublishPost(): { blotatoPostId: string } {
  return { blotatoPostId: `mock-post-${randomUUID().slice(0, 8)}` };
}

export function mockGetPostMetrics(): BlotatoPostMetrics {
  return {
    likes: Math.floor(Math.random() * 500) + 10,
    comments: Math.floor(Math.random() * 50) + 2,
    shares: Math.floor(Math.random() * 100) + 5,
    impressions: Math.floor(Math.random() * 10000) + 500,
    reach: Math.floor(Math.random() * 8000) + 300,
    saves: Math.floor(Math.random() * 30) + 1,
  };
}
