import type { Platform } from "@/types";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlatformIntelligence {
  /** Character limits */
  limits: {
    maxChars: number;
    optimalChars: number;
  };
  /** Hashtag strategy */
  hashtags: {
    recommended: string;
    strategy: string;
  };
  /** Algorithm signal weights (relative multipliers; higher = more impact) */
  algorithm: {
    weights: Record<string, number>;
    timeDecay?: string;
    notes?: string;
  };
  /** Cadence/posting frequency limits */
  cadence: {
    maxPerDay: number;
    notes: string;
    byGrowthStage?: Record<string, number>;
  };
  /** Content format best practices */
  bestPractices: string[];
  /** Tone and voice guidance */
  tone: string;
  /** What makes content feel "native" to the platform */
  nativeRules: string[];
  /** Things to avoid */
  doNot: string[];
}

export interface BuildPlatformPromptOptions {
  followerCount?: number;
}

// ── Platform Intelligence Data ───────────────────────────────────────────────

export const PLATFORM_INTELLIGENCE: Record<Platform, PlatformIntelligence> = {
  TWITTER: {
    limits: { maxChars: 280, optimalChars: 100 },
    hashtags: {
      recommended: "1-2",
      strategy:
        "Use sparingly; 1-2 relevant hashtags max. Hashtag-stuffing kills reach.",
    },
    algorithm: {
      weights: {
        reposts: 20,
        replies: 13.5,
        bookmarks: 10,
        likes: 1,
      },
      timeDecay: "Engagement value halves every 6 hours.",
      notes:
        "Threads get ~3x engagement vs single tweets. Quote tweets with commentary outperform plain reposts.",
    },
    cadence: {
      maxPerDay: 15,
      notes:
        "5/day if under 10k followers, up to 15/day if over 10k. Quality over quantity for smaller accounts.",
      byGrowthStage: {
        "<10k": 5,
        ">10k": 15,
      },
    },
    bestPractices: [
      "Threads get 3x engagement — use for longer ideas.",
      "No links in main tweet for maximum reach; add link in reply.",
      "Single tweet performs best when punchy and conversational.",
      "Quote tweets with original commentary outperform plain reposts.",
    ],
    tone: "Direct, conversational, punchy. Like texting a smart friend. Personality > polish.",
    nativeRules: [
      "Feels like a thought someone had in the moment, not a press release.",
      "Uses line breaks for emphasis, not paragraphs.",
      "Opinions and hot takes get engagement; bland statements don't.",
      "Thread openers should hook with a bold claim or surprising stat.",
    ],
    doNot: [
      "Don't use formal language or corporate jargon.",
      "Don't stuff hashtags (1-2 max).",
      "Don't put links in the main tweet body — reply with link instead.",
      "Don't write threads that could be a single tweet.",
    ],
  },

  INSTAGRAM: {
    limits: { maxChars: 2200, optimalChars: 125 },
    hashtags: {
      recommended: "3-5",
      strategy:
        "Instagram is testing a 5-hashtag limit. Use 3-5 highly relevant hashtags; niche > popular.",
    },
    algorithm: {
      weights: {
        saves: 15,
        shares: 12,
        comments: 8,
        likes: 1,
      },
      notes:
        "Saves are the PRIMARY ranking factor. Originality Score penalizes recycled/reposted content. Carousels outperform Reels for engagement rate.",
    },
    cadence: {
      maxPerDay: 5,
      notes:
        "Max 1 static image + 4 Reels per day. Consistency matters more than volume.",
    },
    bestPractices: [
      "Carousels outperform single images and Reels for engagement.",
      "Hook before the fold (first 125 chars visible without expanding).",
      "Story arc in caption: hook → value → CTA.",
      "Save-worthy content (tips, tutorials, reference material) ranks highest.",
      "Originality Score penalizes recycled or reposted content.",
    ],
    tone: "Aspirational, visual-first. Caption complements the image. Warm and relatable.",
    nativeRules: [
      "Caption should feel like a friend sharing advice, not a brand broadcasting.",
      "Visual storytelling first — text supports the image, not the other way around.",
      "Carousel posts should each slide stand alone but tell a story together.",
      "Use line breaks and emojis as visual structure in longer captions.",
      "Original content only — the algorithm penalizes recycled posts.",
    ],
    doNot: [
      "Don't write wall-of-text captions without line breaks.",
      "Don't exceed 5 hashtags (algorithm may deprioritize).",
      "Don't repost content from other platforms without significant adaptation.",
      "Don't ignore the fold — hook must be in first 125 chars.",
    ],
  },

  FACEBOOK: {
    limits: { maxChars: 63206, optimalChars: 80 },
    hashtags: {
      recommended: "0-2",
      strategy:
        "Minimal hashtags. 0-2 at most. Facebook users don't search by hashtag.",
    },
    algorithm: {
      weights: {
        shares: 15,
        comments: 10,
        reactions: 5,
        likes: 1,
      },
      notes:
        "Questions and conversation-starters drive the most engagement. Short videos (≤15s) outperform long ones.",
    },
    cadence: {
      maxPerDay: 4,
      notes:
        "Max 4 Reels/day. 1-2 posts per day is ideal for most pages. Over-posting reduces per-post reach.",
    },
    bestPractices: [
      "Short videos (≤15 seconds) perform best.",
      "Questions drive significantly more engagement than statements.",
      "Conversational, community-oriented posts outperform polished content.",
      "Native video (uploaded directly) gets priority over YouTube links.",
    ],
    tone: "Conversational, community-oriented. Like talking to neighbors. Warm but not performative.",
    nativeRules: [
      "Feels like someone talking to their community, not a brand page posting.",
      "Questions and polls drive engagement — ask for opinions.",
      "Short-form video (≤15s) is currently prioritized by the algorithm.",
      "Storytelling and personal anecdotes resonate more than tips/listicles.",
    ],
    doNot: [
      "Don't use many hashtags — they look spammy on Facebook.",
      "Don't be overly salesy or promotional.",
      "Don't post YouTube links when you can upload video natively.",
      "Don't post without a conversation hook (question, opinion prompt, etc.).",
    ],
  },

  TIKTOK: {
    limits: { maxChars: 4000, optimalChars: 150 },
    hashtags: {
      recommended: "3-5",
      strategy:
        "Use 3-5 mix of niche + trending hashtags. TikTok hashtags function as SEO keywords.",
    },
    algorithm: {
      weights: {
        completionRate: 20,
        shares: 15,
        comments: 10,
        saves: 8,
        likes: 1,
      },
      notes:
        "Watch-through rate is the #1 signal. 4000-char captions are an SEO mechanism — keywords in title, description, and captions boost discoverability.",
    },
    cadence: {
      maxPerDay: 5,
      notes:
        "Max 5 videos/day. Space posts 1-2 hours apart. New accounts need a 4-week warm-up period (post consistently, don't go viral-chasing).",
    },
    bestPractices: [
      "4000-char captions are an SEO mechanism — front-load keywords.",
      "Hook in the first 1-2 seconds or viewers scroll past.",
      "Keywords in title + description + captions boost discoverability.",
      "1-2 hour spacing between posts for optimal distribution.",
      "New accounts: 4-week warm-up period of consistent posting.",
      "Trending sounds and formats get algorithmic boost.",
    ],
    tone: "Casual, energetic, authentic. Unpolished > polished. Internet-native humor welcome.",
    nativeRules: [
      "Feels like a real person talking, not a brand. Raw and authentic > produced.",
      "Hook viewers in the first 1-2 seconds — open with the payoff or a bold statement.",
      "Trending sounds and formats signal relevance to the algorithm.",
      "Stitch and duet formats signal community participation.",
      "Text overlays are expected and help accessibility + SEO.",
    ],
    doNot: [
      "Don't write formal or corporate copy.",
      "Don't ignore trending formats and sounds.",
      "Don't post videos without text overlays or captions.",
      "Don't spam-post without 1-2 hour spacing.",
      "Don't expect overnight results on new accounts — commit to the 4-week warm-up.",
    ],
  },

  YOUTUBE: {
    limits: { maxChars: 5000, optimalChars: 200 },
    hashtags: {
      recommended: "3-5",
      strategy:
        "3-5 relevant hashtags in description. First 3 appear above the title. Use for discoverability.",
    },
    algorithm: {
      weights: {
        watchTime: 20,
        clickThroughRate: 15,
        likes: 5,
        comments: 8,
        shares: 10,
      },
      notes:
        "Watch time and CTR are the two dominant signals. SEO title should be under 70 characters. Keywords in the first 2 sentences of description.",
    },
    cadence: {
      maxPerDay: 5,
      notes:
        "Max 1 long-form video + 4 Shorts per day. Consistency (same day/time weekly) builds subscriber habits.",
    },
    bestPractices: [
      "SEO title under 70 characters — front-load the keyword.",
      "Keywords in the first 2 sentences of description.",
      "Thumbnail + title are the #1 driver of clicks (CTR).",
      "Shorts: vertical, under 60s, hook in first 2s.",
      "Long-form: first 30 seconds determine retention — deliver value immediately.",
    ],
    tone: "Informative, keyword-rich but natural. Authority with personality. Edu-tainment style.",
    nativeRules: [
      "Title is SEO-first: clear, keyword-rich, under 70 chars.",
      "Description front-loads keywords in the first 2 sentences.",
      "Thumbnails should be high-contrast with readable text and expressive faces.",
      "Shorts should feel native to vertical-first viewing, not cropped landscape.",
      "Community tab posts build subscriber engagement between uploads.",
    ],
    doNot: [
      "Don't keyword-stuff — write naturally with keywords woven in.",
      "Don't write generic descriptions like 'Check out my new video!'",
      "Don't neglect the thumbnail — it's half the battle for CTR.",
      "Don't upload landscape videos as Shorts.",
      "Don't post inconsistently — algorithm rewards regular schedules.",
    ],
  },
};

// ── Prompt Builders ──────────────────────────────────────────────────────────

/**
 * Serializes platform intelligence into prompt text for a single platform.
 * Optionally adjusts cadence recommendations based on follower count (growth stage).
 */
export function buildPlatformPrompt(
  platform: Platform,
  options?: BuildPlatformPromptOptions
): string {
  const intel = PLATFORM_INTELLIGENCE[platform];

  // Determine cadence based on growth stage
  let cadenceStr = `Max ${intel.cadence.maxPerDay} per day.`;
  if (options?.followerCount && intel.cadence.byGrowthStage) {
    const stages = Object.entries(intel.cadence.byGrowthStage);
    for (const [stage, limit] of stages) {
      if (
        (stage.startsWith("<") &&
          options.followerCount < parseInt(stage.slice(1))) ||
        (stage.startsWith(">") &&
          options.followerCount > parseInt(stage.slice(1)))
      ) {
        cadenceStr = `${limit} per day (for ${stage} followers).`;
        break;
      }
    }
  }
  cadenceStr += ` ${intel.cadence.notes}`;

  // Format algorithm weights
  const weightsStr = Object.entries(intel.algorithm.weights)
    .sort(([, a], [, b]) => b - a)
    .map(([signal, weight]) => `${signal}: ${weight}x`)
    .join(", ");

  const sections = [
    `## ${platform} Intelligence`,
    "",
    `### Character Limits`,
    `- Maximum: ${intel.limits.maxChars} characters`,
    `- Optimal: ${intel.limits.optimalChars} characters`,
    "",
    `### Tone & Voice`,
    intel.tone,
    "",
    `### Algorithm Signals (relative weights)`,
    weightsStr,
    intel.algorithm.timeDecay ? `- Time decay: ${intel.algorithm.timeDecay}` : "",
    intel.algorithm.notes ? `- Notes: ${intel.algorithm.notes}` : "",
    "",
    `### Hashtag Strategy (${intel.hashtags.recommended})`,
    intel.hashtags.strategy,
    "",
    `### Cadence`,
    cadenceStr,
    "",
    `### Best Practices`,
    ...intel.bestPractices.map((bp) => `- ${bp}`),
    "",
    `### What Makes Content Native`,
    ...intel.nativeRules.map((rule) => `- ${rule}`),
    "",
    `### Avoid (Do Not)`,
    ...intel.doNot.map((rule) => `- ${rule}`),
  ];

  return sections.filter((s) => s !== "").join("\n");
}

/**
 * Returns cross-platform guidelines for generating content across multiple platforms.
 * Emphasizes that each variant must feel native — not just tone-shifted.
 */
export function buildCrossPlatformGuidelines(
  platforms?: Platform[]
): string {
  const platformList = platforms
    ? platforms.join(", ")
    : "all target platforms";

  return `## Cross-Platform Content Guidelines (${platformList})

### Core Principle
Each variant should feel like it was written by someone who lives on that platform.
Never copy-paste the same text across platforms — each needs a fundamentally different approach.

### Required Diversity Per Variant
For each platform, change ALL of the following (not just tone):
- **Angle**: Lead with a different aspect of the topic for each platform
- **Hook**: The opening line/visual must match how people scroll on that platform
- **Structure**: A Twitter thread ≠ an Instagram carousel ≠ a TikTok caption
- **Format**: Match the dominant content format (text, carousel, video, short-form)
- **Length**: Aim for optimal length, not maximum — shorter is almost always better

### What NOT to Do
- Do not post the same text with minor wording changes across platforms
- Do not use the same hook or opening line on multiple platforms
- Do not ignore platform-specific features (threads, carousels, duets, Shorts)
- Do not treat any platform as a "secondary dump" for content created elsewhere

### Quality Check
Before finalizing, verify each variant passes this test:
"If someone who only uses [platform] saw this, would it feel native or foreign?"`;
}
