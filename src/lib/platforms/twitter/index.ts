// Twitter/X API client
// Uses OAuth 2.0 with PKCE (user context — required for tweet.write)

async function uploadTwitterMedia(
  accessToken: string,
  url: string
): Promise<string> {
  const fileRes = await fetch(url);
  if (!fileRes.ok) throw new Error(`Failed to fetch media from: ${url}`);

  const buffer = await fileRes.arrayBuffer();
  const contentType = fileRes.headers.get("content-type") ?? "image/jpeg";

  const formData = new FormData();
  formData.append("media", new Blob([buffer], { type: contentType }));

  const uploadRes = await fetch("https://upload.twitter.com/1.1/media/upload.json", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });

  if (!uploadRes.ok) {
    const error = await uploadRes.json();
    throw new Error(`Twitter media upload failed: ${JSON.stringify(error)}`);
  }

  const data = await uploadRes.json();
  return data.media_id_string as string;
}

export async function refreshTwitterToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}> {
  const clientId = process.env.TWITTER_CLIENT_ID!;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET!;
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Twitter token refresh failed: ${JSON.stringify(error)}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export async function publishTweet(
  accessToken: string,
  content: string,
  mediaUrls: string[] = []
): Promise<{ id: string; url: string }> {
  const mediaIds: string[] = [];
  for (const url of mediaUrls.slice(0, 4)) {
    const id = await uploadTwitterMedia(accessToken, url);
    mediaIds.push(id);
  }

  const body: Record<string, unknown> = { text: content };
  if (mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }

  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Twitter publish failed: ${JSON.stringify(error)}`);
  }

  const data = await res.json();
  return {
    id: data.data.id,
    url: `https://twitter.com/i/web/status/${data.data.id}`,
  };
}
