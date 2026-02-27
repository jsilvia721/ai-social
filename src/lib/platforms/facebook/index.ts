// Facebook Graph API client

export async function publishFacebookPost(
  accessToken: string,
  pageId: string,
  content: string,
  linkUrl?: string
): Promise<{ id: string }> {
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: content,
      ...(linkUrl ? { link: linkUrl } : {}),
      access_token: accessToken,
    }),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Facebook publish failed: ${JSON.stringify(error)}`);
  }

  return res.json();
}
