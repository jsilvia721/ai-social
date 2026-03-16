/**
 * Mock data for Anthropic Claude API calls.
 * Returns realistic responses without incurring API costs.
 */
import type { Platform } from "@/types";
import type { ContentStrategyInput } from "@/lib/ai/index";
import type { ResearchSynthesis } from "@/lib/ai/research";
import type { BriefGenerationResult } from "@/lib/ai/briefs";

const platformCaptions: Record<Platform, string> = {
  TWITTER:
    "Just shipped a game-changing update to our platform 🚀 The team has been working around the clock and we're so proud of what we've built. #innovation #startup",
  INSTAGRAM:
    "Behind the scenes of our latest project ✨ Swipe to see the journey from concept to launch!\n\nWhat's your favorite part of the creative process?\n\n#behindthescenes #creative #startup #innovation #teamwork",
  FACEBOOK:
    "We're excited to announce something we've been working on for months! Our team poured their hearts into this project, and we can't wait for you to try it out. What features are you most excited about? Drop a comment below! 👇",
  TIKTOK:
    "POV: your startup just hit a major milestone 🎯 #startup #tech #milestone #worklife",
  YOUTUBE:
    "In this video, we break down our latest product update and show you exactly how it works. From the initial concept to the final implementation, we cover everything you need to know. Don't forget to like and subscribe for more updates!",
};

export function mockGeneratePostContent(
  topic: string,
  platform: Platform,
): string {
  const base = platformCaptions[platform];
  return base.replace("our latest project", `"${topic}"`);
}

export function mockExtractContentStrategy(
  wizardAnswers: Record<string, unknown>,
): ContentStrategyInput {
  const industry =
    (typeof wizardAnswers["Business type"] === "string" ? wizardAnswers["Business type"] : undefined) ||
    (typeof wizardAnswers["industry"] === "string" ? wizardAnswers["industry"] : undefined) ||
    "Technology & SaaS";
  const audience =
    (typeof wizardAnswers["Target audience"] === "string" ? wizardAnswers["Target audience"] : undefined) ||
    (typeof wizardAnswers["targetAudience"] === "string" ? wizardAnswers["targetAudience"] : undefined) ||
    "Tech-savvy professionals aged 25-45";

  return {
    industry,
    targetAudience: audience,
    contentPillars: [
      "Industry insights and trends",
      "Behind-the-scenes content",
      "Customer success stories",
      "Educational how-to guides",
    ],
    brandVoice:
      "Professional yet approachable. Data-driven with a human touch. We educate and inspire without being preachy.",
    optimizationGoal: "ENGAGEMENT",
    reviewWindowEnabled: true,
    reviewWindowHours: 24,
    accountType: "BUSINESS",
    visualStyle: "",
  };
}

export function mockAnalyzePerformance(): {
  patterns: string[];
  formatMixChanges?: Record<string, number>;
  cadenceChanges?: Record<string, number>;
  topicInsights?: string[];
  digest: string;
} {
  return {
    patterns: [
      "Video content consistently outperforms text posts by 2.3x in engagement rate",
      "Posts published between 9-11am receive 40% more impressions",
      "Customer story content drives the highest comment rates",
      "Carousel posts on Instagram have 1.8x the saves compared to single images",
    ],
    formatMixChanges: { VIDEO: 0.1, TEXT: -0.05, CAROUSEL: 0.05, IMAGE: -0.1 },
    cadenceChanges: { TWITTER: 1, INSTAGRAM: 0, FACEBOOK: -1 },
    topicInsights: [
      "Double down on 'Industry insights' — highest engagement pillar",
      "Reduce generic motivational content — lowest performer",
      "Customer stories generate 3x more shares — increase frequency",
    ],
    digest:
      "[MOCK] This week's performance shows strong engagement with video and educational content. Your audience responds best to data-backed insights shared in the morning. Consider shifting more budget toward video production and reducing text-only posts. Customer stories remain your strongest engagement driver.",
  };
}

export function mockSynthesizeResearch(): ResearchSynthesis {
  return {
    themes: [
      {
        title: "AI-Powered Productivity Tools Rising",
        summary:
          "The market for AI productivity tools is accelerating with several major launches this week. Your audience is actively discussing automation workflows.",
        relevanceScore: 0.92,
        suggestedAngles: [
          "Compare top AI tools for your industry",
          "Share your team's AI workflow setup",
          "Poll: Which AI tool changed your workflow the most?",
        ],
      },
      {
        title: "Remote Work Culture Evolution",
        summary:
          "Companies are redefining hybrid work policies. Discussions around async communication and work-life balance are trending in your target communities.",
        relevanceScore: 0.78,
        suggestedAngles: [
          "Share your team's remote work rituals",
          "Tips for effective async communication",
          "Behind-the-scenes of a day in your remote team",
        ],
      },
      {
        title: "Sustainable Business Practices",
        summary:
          "Growing consumer demand for transparency in sustainability practices. Your industry peers are sharing impact reports and eco-friendly initiatives.",
        relevanceScore: 0.65,
        suggestedAngles: [
          "Your company's sustainability journey",
          "Simple eco-friendly business tips",
          "How your product contributes to sustainability",
        ],
      },
    ],
    overallSummary:
      "[MOCK] The current landscape favors educational, behind-the-scenes content about AI adoption and modern work practices. Your audience is hungry for practical insights over promotional content.",
  };
}

export function mockGenerateVideoStoryboard(topic: string): {
  videoScript: string;
  videoPrompt: string;
  thumbnailPrompt: string;
} {
  return {
    videoScript: `[MOCK] Scene 1: Open on a wide shot establishing the context of "${topic}". Scene 2: Present key insights with dynamic visuals. Scene 3: Close with a call to action and brand logo.`,
    videoPrompt: `[MOCK] A cinematic short-form video about ${topic}, featuring smooth transitions, dynamic text overlays, and professional color grading.`,
    thumbnailPrompt: `[MOCK] Eye-catching YouTube thumbnail for a video about ${topic}, bold text overlay, vibrant colors, professional quality.`,
  };
}

export function mockGenerateBriefs(
  connectedPlatforms: string[],
  cadencePerPlatform: Record<string, number>,
): BriefGenerationResult {
  const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
  const times = ["09:00", "11:00", "14:00", "16:00"];
  const formats = ["TEXT", "IMAGE", "CAROUSEL", "VIDEO"] as const;

  const briefs: BriefGenerationResult["briefs"] = [];
  let dayIdx = 0;
  let timeIdx = 0;

  for (const platform of connectedPlatforms) {
    const count = cadencePerPlatform[platform] ?? 2;
    for (let i = 0; i < count; i++) {
      briefs.push({
        topic: `[MOCK] Weekly ${platform.toLowerCase()} content idea #${i + 1}`,
        rationale:
          "This topic aligns with current industry trends and has shown strong engagement potential based on recent research.",
        suggestedCaption: `[MOCK] Here's a great insight about our industry that we think you'll love. What are your thoughts? ${platform === "INSTAGRAM" || platform === "TIKTOK" ? "#industry #insights #content" : ""}`,
        recommendedFormat: formats[i % formats.length],
        platform: platform as "TWITTER" | "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "YOUTUBE",
        suggestedDay: `${days[dayIdx % days.length]} ${times[timeIdx % times.length]}`,
      });
      timeIdx++;
    }
    dayIdx++;
  }

  return { briefs };
}
