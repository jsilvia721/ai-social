// Facebook Graph API client
// Uses Page Access Token (obtained via Meta OAuth flow)

const GRAPH_URL = "https://graph.facebook.com/v19.0";

export async function publishFacebookPost(
  accessToken: string,
  pageId: string,
  content: string,
  mediaUrls: string[] = []
): Promise<{ id: string }> {
  if (mediaUrls.length === 1) {
    // Single photo — /photos endpoint publishes and creates the feed post in one step
    const res = await fetch(`${GRAPH_URL}/${pageId}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: mediaUrls[0],
        caption: content,
        access_token: accessToken,
      }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(`Facebook photo post failed: ${JSON.stringify(error)}`);
    }
    const data = await res.json();
    // /photos returns { id, post_id } — post_id is the feed post id
    return { id: (data.post_id ?? data.id) as string };
  }

  if (mediaUrls.length > 1) {
    // Multiple photos — upload each as unpublished, then attach to a single feed post
    const photoIds: string[] = [];
    for (const url of mediaUrls.slice(0, 10)) {
      const photoRes = await fetch(`${GRAPH_URL}/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          published: false,
          access_token: accessToken,
        }),
      });
      if (!photoRes.ok) {
        const error = await photoRes.json();
        throw new Error(`Facebook photo upload failed: ${JSON.stringify(error)}`);
      }
      const { id } = await photoRes.json();
      photoIds.push(id as string);
    }

    const feedRes = await fetch(`${GRAPH_URL}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: content,
        attached_media: photoIds.map((id) => ({ media_fbid: id })),
        access_token: accessToken,
      }),
    });
    if (!feedRes.ok) {
      const error = await feedRes.json();
      throw new Error(`Facebook publish failed: ${JSON.stringify(error)}`);
    }
    return feedRes.json();
  }

  // Text-only post
  const res = await fetch(`${GRAPH_URL}/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: content,
      access_token: accessToken,
    }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Facebook publish failed: ${JSON.stringify(error)}`);
  }
  return res.json();
}
