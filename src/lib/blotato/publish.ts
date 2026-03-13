import { blotatoFetch } from "./client";
import { assertSafeMediaUrl } from "./ssrf-guard";
import { BlotatoPublishResultSchema } from "./types";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import { mockPublishPost } from "@/lib/mocks/blotato";

export async function publishPost(
  blotatoAccountId: string,
  content: string,
  platform: string,
  mediaUrls: string[] = [],
): Promise<{ blotatoPostId: string }> {
  if (shouldMockExternalApis()) return mockPublishPost();

  // Validate all media URLs before sending to Blotato
  for (const url of mediaUrls) {
    assertSafeMediaUrl(url);
  }

  const blotatoPlatform = platform.toLowerCase();

  const target = buildTarget(blotatoPlatform);

  const body = {
    post: {
      accountId: blotatoAccountId,
      content: {
        text: content,
        mediaUrls,
        platform: blotatoPlatform,
      },
      target,
    },
  };

  const result = await blotatoFetch("/posts", BlotatoPublishResultSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return { blotatoPostId: result.postSubmissionId };
}

interface BaseTarget {
  targetType: string;
}

interface TikTokTarget extends BaseTarget {
  privacyLevel: string;
  disabledComments: boolean;
  disabledDuet: boolean;
  disabledStitch: boolean;
  isBrandedContent: boolean;
  isYourBrand: boolean;
  isAiGenerated: boolean;
}

/** Build platform-specific target object for the Blotato API. */
function buildTarget(platform: string): BaseTarget | TikTokTarget {
  if (platform === "tiktok") {
    return {
      targetType: platform,
      privacyLevel: "PUBLIC_TO_EVERYONE",
      disabledComments: false,
      disabledDuet: false,
      disabledStitch: false,
      isBrandedContent: false,
      isYourBrand: false,
      isAiGenerated: true,
    };
  }

  return { targetType: platform };
}
