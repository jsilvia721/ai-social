import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { z } from "zod";
import type { Platform } from "@/types";

const client = new Anthropic();

export async function generatePostContent(
  topic: string,
  platform: Platform,
  tone?: string
): Promise<string> {
  const platformGuide: Record<Platform, string> = {
    TWITTER: "Keep it under 280 characters. Use hashtags sparingly.",
    INSTAGRAM: "Can be longer. Use emojis and 3-5 relevant hashtags.",
    FACEBOOK: "Conversational tone. Can include a question to drive engagement.",
    TIKTOK: "Short, punchy caption. Use trending hashtags. Keep it casual and energetic.",
    YOUTUBE: "Write a compelling video description. Include keywords naturally in the first 2 sentences.",
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

// ── Content Strategy Extraction ──────────────────────────────────────────────

const ContentStrategyInputSchema = z.object({
  industry: z.string().min(1),
  targetAudience: z.string().min(1),
  contentPillars: z.array(z.string()).min(1),
  brandVoice: z.string().min(1),
  optimizationGoal: z.enum(["ENGAGEMENT", "REACH", "CONVERSIONS", "BRAND_AWARENESS"]),
  reviewWindowEnabled: z.boolean(),
  reviewWindowHours: z.number().int().positive(),
});

export type ContentStrategyInput = z.infer<typeof ContentStrategyInputSchema>;

const contentStrategyTool: Anthropic.Tool = {
  name: "save_content_strategy",
  description:
    "Extract and save a structured content strategy from the user's onboarding answers. Call this tool with the extracted strategy.",
  input_schema: {
    type: "object",
    properties: {
      industry: {
        type: "string",
        description: "The business industry or niche (e.g., 'Fitness', 'SaaS', 'E-commerce')",
      },
      targetAudience: {
        type: "string",
        description: "Detailed description of the ideal customer or audience",
      },
      contentPillars: {
        type: "array",
        items: { type: "string" },
        description: "3-5 content themes that anchor the social media strategy",
      },
      brandVoice: {
        type: "string",
        description: "A paragraph describing the brand's tone, personality, and communication style",
      },
      optimizationGoal: {
        type: "string",
        enum: ["ENGAGEMENT", "REACH", "CONVERSIONS", "BRAND_AWARENESS"],
        description: "The primary business goal for social media content",
      },
      reviewWindowEnabled: {
        type: "boolean",
        description: "Whether AI-generated posts require human approval before publishing",
      },
      reviewWindowHours: {
        type: "number",
        description: "Hours the human has to review before auto-publishing (typically 24)",
      },
    },
    required: [
      "industry",
      "targetAudience",
      "contentPillars",
      "brandVoice",
      "optimizationGoal",
      "reviewWindowEnabled",
      "reviewWindowHours",
    ],
  },
};

// Few-shot example: teaches Claude the expected output richness
const CONTENT_STRATEGY_FEW_SHOT: MessageParam[] = [
  {
    role: "user",
    content:
      "Business type: Boutique HIIT fitness studio\nTarget audience: Busy professionals, 30-45\nTone preference: Energetic but science-backed\nPrimary goal: Grow membership",
  },
  {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "ex_01",
        name: "save_content_strategy",
        input: {
          industry: "Fitness & Wellness",
          targetAudience:
            "Busy professionals aged 30-45 who value efficiency, data-driven results, and community accountability",
          contentPillars: [
            "Science-backed workout tips",
            "Nutrition for performance",
            "Member transformation stories",
            "Mindset and recovery",
          ],
          brandVoice:
            "Energetic, no-nonsense, and science-backed. We respect your time — every post delivers one actionable insight. Warm community tone, never preachy.",
          optimizationGoal: "REACH",
          reviewWindowEnabled: false,
          reviewWindowHours: 24,
        },
      },
    ],
  },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "ex_01", content: "Strategy saved." }],
  },
];

function buildOnboardingPrompt(answers: Record<string, string>): string {
  const lines = Object.entries(answers).map(([k, v]) => `${k}: ${v}`);
  return (
    "Extract a content strategy from these onboarding answers and call save_content_strategy:\n\n" +
    lines.join("\n")
  );
}

export async function extractContentStrategy(
  wizardAnswers: Record<string, string>
): Promise<ContentStrategyInput> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    tools: [contentStrategyTool],
    tool_choice: { type: "any" },
    messages: [
      ...CONTENT_STRATEGY_FEW_SHOT,
      {
        role: "user",
        content: buildOnboardingPrompt(wizardAnswers),
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not call save_content_strategy");
  }

  return ContentStrategyInputSchema.parse(toolUse.input);
}

export async function suggestOptimalTimes(
  platform: Platform,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  timezone: string
): Promise<Date[]> {
  const now = new Date();
  // Placeholder: return sensible defaults per platform
  // In production this would use engagement analytics
  const defaults: Record<Platform, number[]> = {
    TWITTER: [9, 12, 17],
    INSTAGRAM: [11, 14, 19],
    FACEBOOK: [9, 13, 16],
    TIKTOK: [7, 14, 21],
    YOUTUBE: [15, 17, 20],
  };

  return defaults[platform].map((hour) => {
    const d = new Date(now);
    d.setHours(hour, 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  });
}
