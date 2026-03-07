// TikTok Content Posting API client
// Uses OAuth 2.0 with PKCE (user context)
//
// NOTE: The Content Posting API requires TikTok business account approval.
// Until approved, publishTikTokVideo() will throw a clear error so the
// post is marked FAILED with an explanatory message rather than silently hanging.
//
// Publish status is NOT polled synchronously. TikTok processes uploads
// asynchronously; polling up to 30s would block the scheduler. The publish_id
// is stored as the post's platform ID so status can be checked later if needed.

import { env } from "@/env";
import { assertSafeMediaUrl } from "@/lib/platforms/ssrf-guard";

const TIKTOK_POST_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";
const TIKTOK_REFRESH_URL = "https://open.tiktokapis.com/v2/oauth/token/";

export async function refreshTikTokToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }> {
  const clientId = env.TIKTOK_CLIENT_ID;
  const clientSecret = env.TIKTOK_CLIENT_SECRET;

  const res = await fetch(TIKTOK_REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`TikTok token refresh failed: ${JSON.stringify(error)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export async function publishTikTokVideo(
  accessToken: string,
  caption: string,
  mediaUrls: string[] = []
): Promise<{ id: string }> {
  if (mediaUrls.length === 0) {
    throw new Error(
      "TikTok requires a video file. Attach a video before scheduling."
    );
  }

  // SSRF guard: validate the URL originates from our own S3 storage
  assertSafeMediaUrl(mediaUrls[0]);

  // Initiate publish via PULL_FROM_URL (TikTok fetches from our S3 URL)
  const res = await fetch(TIKTOK_POST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      post_info: {
        title: caption.slice(0, 2200), // TikTok caption limit
        privacy_level: "SELF_ONLY", // safe default — creator can change in app
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "PULL_FROM_URL",
        video_url: mediaUrls[0],
      },
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    const errCode = error?.error?.code ?? "";
    // TikTok returns specific error codes when API access isn't approved
    if (errCode === "access_token_invalid" || errCode === "scope_not_authorized") {
      throw new Error(
        "TikTok Content Posting API access not yet approved. " +
          "Apply at https://developers.tiktok.com and complete business verification."
      );
    }
    throw new Error(`TikTok publish init failed: ${JSON.stringify(error)}`);
  }

  const data = await res.json();
  const publishId = typeof data?.data?.publish_id === "string" ? data.data.publish_id : null;

  if (!publishId) {
    throw new Error("TikTok publish init did not return a publish_id");
  }

  return { id: publishId };
}
