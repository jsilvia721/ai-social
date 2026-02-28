// Instagram Graph API client
// Uses Page Access Token (obtained via Meta OAuth flow)

const GRAPH_URL = "https://graph.facebook.com/v19.0";

async function waitForContainer(
  accessToken: string,
  containerId: string,
  maxWaitMs = 10_000
): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${GRAPH_URL}/${containerId}?fields=status_code&access_token=${accessToken}`
    );
    if (!res.ok) {
      const error = await res.json();
      throw new Error(`Instagram container status check failed: ${JSON.stringify(error)}`);
    }
    const { status_code } = await res.json();
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR") {
      throw new Error("Instagram media container processing failed");
    }
    // IN_PROGRESS — wait and retry
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Instagram media container timed out after 10s");
}

async function createItemContainer(
  accessToken: string,
  igUserId: string,
  imageUrl: string,
  isCarouselItem: boolean
): Promise<string> {
  const res = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      media_type: "IMAGE",
      ...(isCarouselItem ? { is_carousel_item: "true" } : {}),
      access_token: accessToken,
    }),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(`Instagram container creation failed: ${JSON.stringify(error)}`);
  }
  const { id } = await res.json();
  return id as string;
}

export async function publishInstagramPost(
  accessToken: string,
  igUserId: string,
  content: string,
  mediaUrls: string[] = []
): Promise<{ id: string }> {
  if (mediaUrls.length === 0) {
    throw new Error(
      "Instagram requires at least one image URL. Attach an image before scheduling."
    );
  }

  let containerId: string;

  if (mediaUrls.length === 1) {
    // Single image post
    containerId = await createItemContainer(accessToken, igUserId, mediaUrls[0], false);
  } else {
    // Carousel post (2–10 images)
    // Step 1: create and wait for each child container
    const childIds: string[] = [];
    for (const url of mediaUrls.slice(0, 10)) {
      const childId = await createItemContainer(accessToken, igUserId, url, true);
      await waitForContainer(accessToken, childId);
      childIds.push(childId);
    }

    // Step 2: create the carousel container
    const carouselRes = await fetch(`${GRAPH_URL}/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        caption: content,
        media_type: "CAROUSEL",
        children: childIds.join(","),
        access_token: accessToken,
      }),
    });
    if (!carouselRes.ok) {
      const error = await carouselRes.json();
      throw new Error(`Instagram carousel creation failed: ${JSON.stringify(error)}`);
    }
    const { id } = await carouselRes.json();
    containerId = id as string;
  }

  // Wait for the final container to be ready before publishing
  await waitForContainer(accessToken, containerId);

  // Publish
  const publishRes = await fetch(`${GRAPH_URL}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: containerId, access_token: accessToken }),
  });

  if (!publishRes.ok) {
    const error = await publishRes.json();
    throw new Error(`Instagram publish failed: ${JSON.stringify(error)}`);
  }

  return publishRes.json();
}
