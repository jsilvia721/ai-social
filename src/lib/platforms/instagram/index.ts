// Instagram Graph API client

export async function publishInstagramPost(
  accessToken: string,
  igUserId: string,
  content: string,
  imageUrl?: string
): Promise<{ id: string }> {
  // Step 1: Create media container
  const containerRes = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caption: content,
        ...(imageUrl ? { image_url: imageUrl, media_type: "IMAGE" } : { media_type: "TEXT" }),
        access_token: accessToken,
      }),
    }
  );

  if (!containerRes.ok) {
    const error = await containerRes.json();
    throw new Error(`Instagram container creation failed: ${JSON.stringify(error)}`);
  }

  const { id: creationId } = await containerRes.json();

  // Step 2: Publish the container
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: creationId, access_token: accessToken }),
    }
  );

  if (!publishRes.ok) {
    const error = await publishRes.json();
    throw new Error(`Instagram publish failed: ${JSON.stringify(error)}`);
  }

  return publishRes.json();
}
