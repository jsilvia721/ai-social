import { blotatoFetch } from "./client";
import { assertSafeMediaUrl } from "./ssrf-guard";
import { BlotatoPublishResultSchema } from "./types";

export async function publishPost(
  blotatoAccountId: string,
  content: string,
  mediaUrls: string[] = [],
): Promise<{ blotatoPostId: string }> {
  // Validate all media URLs before sending to Blotato
  for (const url of mediaUrls) {
    assertSafeMediaUrl(url);
  }

  const body: Record<string, unknown> = {
    accountId: blotatoAccountId,
    content,
  };
  if (mediaUrls.length > 0) {
    body.mediaUrls = mediaUrls;
  }

  const result = await blotatoFetch("/posts", BlotatoPublishResultSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return { blotatoPostId: result.id };
}
