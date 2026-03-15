/**
 * Prompt augmentation for image and content generation.
 * Adds Creative Profile context (accountType, visualStyle) to base prompts.
 */

export function buildImagePrompt(
  basePrompt: string,
  creative: { accountType?: string; visualStyle?: string | null }
): string {
  const parts = [basePrompt];

  if (creative.accountType === "MEME") {
    parts.push(
      "Style: bold, eye-catching, meme-format, high contrast, internet culture aesthetic."
    );
  } else if (creative.accountType === "INFLUENCER") {
    parts.push(
      "Style: aspirational, lifestyle photography, warm tones, authentic feel."
    );
  } else {
    // BUSINESS or default
    parts.push("Style: professional, clean, brand-appropriate, polished.");
  }

  if (creative.visualStyle) {
    // Sanitize: strip control characters, limit length, quote to reduce injection surface
    const safe = creative.visualStyle
      .replace(/[\x00-\x1F\x7F]/g, "")
      .slice(0, 500);
    if (safe) {
      parts.push(`Visual direction: "${safe}".`);
    }
  }

  return parts.join(" ");
}

/**
 * Build a video generation prompt with accountType style, visualStyle,
 * platform hint, and text overlay directive.
 */
export function buildVideoPrompt(
  basePrompt: string,
  creative: { accountType?: string; visualStyle?: string | null },
  platform: string,
  aspectRatio: string
): string {
  const parts = [basePrompt];

  if (creative.accountType === "MEME") {
    parts.push("Motion style: fast cuts, bold visuals, high energy.");
  } else if (creative.accountType === "INFLUENCER") {
    parts.push("Motion style: smooth tracking, warm tones, authentic movement.");
  } else {
    // BUSINESS or default
    parts.push("Motion style: clean transitions, professional, polished.");
  }

  if (creative.visualStyle) {
    const safe = creative.visualStyle
      .replace(/[\x00-\x1F\x7F]/g, "")
      .slice(0, 500);
    if (safe) {
      parts.push(`Visual direction: "${safe}".`);
    }
  }

  parts.push(`Optimized for ${platform} at ${aspectRatio}.`);
  parts.push("Leave clear negative space in upper third for text overlay.");

  return parts.join(" ");
}
