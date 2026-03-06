// YouTube Data API v3 client
// Uses Google OAuth 2.0 (access_type=offline for refresh tokens)

import { env } from "@/env";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";

export async function refreshYouTubeToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: Date;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`YouTube token refresh failed: ${JSON.stringify(error)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    // Google refresh tokens don't expire; new access token lasts 3600s
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
  };
}

export async function publishYouTubeVideo(
  accessToken: string,
  content: string,
  mediaUrls: string[] = []
): Promise<{ id: string; url: string }> {
  if (mediaUrls.length === 0) {
    throw new Error(
      "YouTube requires a video file. Attach a video before scheduling."
    );
  }

  // SSRF guard: only fetch from our own storage
  const allowedStoragePrefix = process.env.MINIO_PUBLIC_URL ?? "http://localhost:9000";
  if (!mediaUrls[0].startsWith(allowedStoragePrefix)) {
    throw new Error("Invalid media URL: only internal storage URLs are permitted");
  }

  // Use the first line of content as the video title (max 100 chars)
  const title = content.split("\n")[0].slice(0, 100) || "Untitled";

  const metadata = {
    snippet: {
      title,
      description: content,
      categoryId: "22", // People & Blogs — sensible default
    },
    status: {
      privacyStatus: "public",
    },
  };

  // Step 1: Fetch video from S3 (don't buffer — stream body to YouTube)
  const videoRes = await fetch(mediaUrls[0]);
  if (!videoRes.ok) {
    throw new Error(`Failed to fetch video from storage: ${mediaUrls[0]}`);
  }
  const contentType = videoRes.headers.get("content-type") ?? "video/mp4";
  const contentLength = videoRes.headers.get("content-length");

  // Step 2: Initiate YouTube resumable upload session
  const initHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "X-Upload-Content-Type": contentType,
  };
  if (contentLength) initHeaders["X-Upload-Content-Length"] = contentLength;

  const initRes = await fetch(
    `${YOUTUBE_UPLOAD_URL}?uploadType=resumable&part=snippet,status`,
    { method: "POST", headers: initHeaders, body: JSON.stringify(metadata) }
  );

  if (!initRes.ok) {
    const error = await initRes.json();
    throw new Error(`YouTube upload init failed: ${JSON.stringify(error)}`);
  }

  const uploadUri = initRes.headers.get("location");
  if (!uploadUri) {
    throw new Error("YouTube upload init did not return an upload URI");
  }

  // Step 3: Stream video bytes from S3 directly to YouTube (no server-side buffer)
  const uploadHeaders: Record<string, string> = { "Content-Type": contentType };
  if (contentLength) uploadHeaders["Content-Length"] = contentLength;

  const uploadRes = await fetch(uploadUri, {
    method: "PUT",
    headers: uploadHeaders,
    body: videoRes.body,
    // @ts-expect-error — Node.js requires duplex option for streaming request bodies
    duplex: "half",
  });

  if (!uploadRes.ok) {
    const error = await uploadRes.json();
    throw new Error(`YouTube upload failed: ${JSON.stringify(error)}`);
  }

  const data = await uploadRes.json();
  const videoId = typeof data?.id === "string" ? data.id : null;
  if (!videoId) {
    throw new Error(`YouTube upload response missing video ID: ${JSON.stringify(data)}`);
  }

  return {
    id: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
