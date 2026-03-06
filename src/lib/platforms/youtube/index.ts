// YouTube Data API v3 client
// Uses Google OAuth 2.0 (access_type=offline for refresh tokens)

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
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
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
  description: string,
  mediaUrls: string[] = []
): Promise<{ id: string; url: string }> {
  if (mediaUrls.length === 0) {
    throw new Error(
      "YouTube requires a video file. Attach a video before scheduling."
    );
  }

  // Fetch the video from our S3 URL
  const videoRes = await fetch(mediaUrls[0]);
  if (!videoRes.ok) {
    throw new Error(`Failed to fetch video from storage: ${mediaUrls[0]}`);
  }
  const videoBuffer = await videoRes.arrayBuffer();
  const contentType = videoRes.headers.get("content-type") ?? "video/mp4";

  // Use the first line of the description as the title (max 100 chars)
  const title = description.split("\n")[0].slice(0, 100) || "Untitled";

  // Metadata upload part
  const metadata = {
    snippet: {
      title,
      description,
      categoryId: "22", // People & Blogs — sensible default
    },
    status: {
      privacyStatus: "public",
    },
  };

  // Resumable upload — single request for files that fit in memory
  const params = new URLSearchParams({
    uploadType: "multipart",
    part: "snippet,status",
  });

  const boundary = "boundary_ai_social";
  const metadataPart = JSON.stringify(metadata);
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metadataPart,
    `--${boundary}`,
    `Content-Type: ${contentType}`,
    "",
    "",
  ].join("\r\n");

  const bodyBuffer = Buffer.concat([
    Buffer.from(body, "utf-8"),
    Buffer.from(videoBuffer),
    Buffer.from(`\r\n--${boundary}--`, "utf-8"),
  ]);

  const res = await fetch(`${YOUTUBE_UPLOAD_URL}?${params.toString()}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
      "Content-Length": String(bodyBuffer.length),
    },
    body: bodyBuffer,
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`YouTube upload failed: ${JSON.stringify(error)}`);
  }

  const data = await res.json();
  const videoId = data.id as string;

  return {
    id: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
