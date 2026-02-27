import Anthropic from "@anthropic-ai/sdk";
import type { Platform } from "@/types";

const client = new Anthropic();

export async function generatePostContent(
  topic: string,
  platform: Platform,
  tone?: string
): Promise<string> {
  const platformGuide = {
    TWITTER: "Keep it under 280 characters. Use hashtags sparingly.",
    INSTAGRAM: "Can be longer. Use emojis and 3-5 relevant hashtags.",
    FACEBOOK: "Conversational tone. Can include a question to drive engagement.",
  };

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `Write a social media post for ${platform} about: ${topic}.
${tone ? `Tone: ${tone}.` : ""}
${platformGuide[platform]}
Return only the post text, no explanation.`,
      },
    ],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type from AI");
  return content.text;
}

export async function suggestOptimalTimes(
  platform: Platform,
  timezone: string
): Promise<Date[]> {
  const now = new Date();
  // Placeholder: return sensible defaults per platform
  // In production this would use engagement analytics
  const defaults: Record<Platform, number[]> = {
    TWITTER: [9, 12, 17],
    INSTAGRAM: [11, 14, 19],
    FACEBOOK: [9, 13, 16],
  };

  return defaults[platform].map((hour) => {
    const d = new Date(now);
    d.setHours(hour, 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  });
}
