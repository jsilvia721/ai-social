/**
 * Hook Frameworks Knowledge Module
 *
 * 10 proven hook types (validated by Blotato / industry best practices)
 * with platform affinity scores and contextual selection logic.
 */

import type { Platform } from "@prisma/client";

export type { Platform };

export type OptimizationGoal =
  | "ENGAGEMENT"
  | "REACH"
  | "CONVERSIONS"
  | "BRAND_AWARENESS";

export type AccountType = "BUSINESS" | "INFLUENCER" | "MEME";

export type HookName =
  | "Pattern Interrupt"
  | "Authority Builder"
  | "Problem-Agitate-Solution"
  | "Hidden Secret"
  | "Before/After Bridge"
  | "Educational"
  | "Social Proof"
  | "Myth Buster"
  | "Quick Win"
  | "FOMO";

export interface HookFramework {
  name: HookName;
  description: string;
  examples: string[];
  platformAffinity: Record<Platform, number>;
}

/**
 * Goal boost: how much each hook type benefits from a given optimization goal.
 * Values are additive bonuses (0–0.3) applied on top of platform affinity.
 */
const GOAL_BOOSTS: Record<OptimizationGoal, Partial<Record<HookName, number>>> = {
  ENGAGEMENT: {
    "Pattern Interrupt": 0.3,
    "Myth Buster": 0.2,
    FOMO: 0.2,
    "Quick Win": 0.15,
    "Social Proof": 0.1,
  },
  REACH: {
    Educational: 0.3,
    "Quick Win": 0.2,
    "Pattern Interrupt": 0.15,
    "Authority Builder": 0.15,
    "Myth Buster": 0.1,
  },
  CONVERSIONS: {
    "Problem-Agitate-Solution": 0.3,
    "Before/After Bridge": 0.25,
    "Social Proof": 0.2,
    FOMO: 0.2,
    "Hidden Secret": 0.15,
  },
  BRAND_AWARENESS: {
    "Authority Builder": 0.3,
    Educational: 0.2,
    "Social Proof": 0.2,
    "Before/After Bridge": 0.15,
    "Hidden Secret": 0.1,
  },
};

/**
 * Account type boost: adjusts scoring based on content creator type.
 */
const ACCOUNT_TYPE_BOOSTS: Record<AccountType, Partial<Record<HookName, number>>> = {
  BUSINESS: {
    "Authority Builder": 0.2,
    "Problem-Agitate-Solution": 0.15,
    "Social Proof": 0.15,
    Educational: 0.1,
  },
  INFLUENCER: {
    "Before/After Bridge": 0.2,
    "Hidden Secret": 0.15,
    "Social Proof": 0.15,
    "Pattern Interrupt": 0.1,
  },
  MEME: {
    "Pattern Interrupt": 0.25,
    "Myth Buster": 0.2,
    "Quick Win": 0.15,
    FOMO: 0.1,
  },
};

export const HOOK_FRAMEWORKS: HookFramework[] = [
  {
    name: "Pattern Interrupt",
    description:
      "Breaks the scroll pattern with an unexpected statement or question that stops readers mid-scroll.",
    examples: [
      "Stop scrolling. This changed everything about how I work.",
      "I was wrong about this for 10 years.",
      "This is the worst advice on the internet right now.",
    ],
    platformAffinity: {
      TWITTER: 0.9,
      INSTAGRAM: 0.7,
      FACEBOOK: 0.6,
      TIKTOK: 0.95,
      YOUTUBE: 0.8,
    },
  },
  {
    name: "Authority Builder",
    description:
      "Establishes credibility upfront by leading with experience, credentials, or results.",
    examples: [
      "After managing $10M in ad spend, here's what actually works.",
      "I've hired 200+ people. The #1 red flag in interviews is...",
    ],
    platformAffinity: {
      TWITTER: 0.8,
      INSTAGRAM: 0.6,
      FACEBOOK: 0.7,
      TIKTOK: 0.5,
      YOUTUBE: 0.85,
    },
  },
  {
    name: "Problem-Agitate-Solution",
    description:
      "Identifies a pain point, intensifies it, then hints at the solution to create tension.",
    examples: [
      "Your content isn't getting views. And it's not the algorithm — it's your first line.",
      "Posting every day but still no growth? The problem isn't frequency.",
      "Most businesses waste 80% of their social media budget. Here's why.",
    ],
    platformAffinity: {
      TWITTER: 0.7,
      INSTAGRAM: 0.75,
      FACEBOOK: 0.8,
      TIKTOK: 0.6,
      YOUTUBE: 0.85,
    },
  },
  {
    name: "Hidden Secret",
    description:
      "Creates curiosity by promising insider knowledge or little-known information.",
    examples: [
      "The algorithm trick nobody is talking about.",
      "There's a hidden feature in Instagram most creators don't know about.",
    ],
    platformAffinity: {
      TWITTER: 0.75,
      INSTAGRAM: 0.8,
      FACEBOOK: 0.65,
      TIKTOK: 0.85,
      YOUTUBE: 0.9,
    },
  },
  {
    name: "Before/After Bridge",
    description:
      "Paints a picture of the current state vs. the desired state, bridging them with a solution.",
    examples: [
      "6 months ago I had 500 followers. Today I have 50,000. Here's the shift.",
      "Before: spending 4 hours on content. After: 30 minutes with better results.",
    ],
    platformAffinity: {
      TWITTER: 0.7,
      INSTAGRAM: 0.85,
      FACEBOOK: 0.75,
      TIKTOK: 0.7,
      YOUTUBE: 0.8,
    },
  },
  {
    name: "Educational",
    description:
      "Leads with a clear value proposition — the reader will learn something specific and useful.",
    examples: [
      "5 copywriting frameworks that will 10x your engagement.",
      "The science behind why some posts go viral (and most don't).",
      "How to write hooks that convert — a thread.",
    ],
    platformAffinity: {
      TWITTER: 0.85,
      INSTAGRAM: 0.7,
      FACEBOOK: 0.75,
      TIKTOK: 0.6,
      YOUTUBE: 0.9,
    },
  },
  {
    name: "Social Proof",
    description:
      "Leverages social validation, testimonials, or crowd behavior to build trust.",
    examples: [
      "10,000 people downloaded this template last week. Here's why.",
      "Every top creator I know does this one thing differently.",
    ],
    platformAffinity: {
      TWITTER: 0.7,
      INSTAGRAM: 0.8,
      FACEBOOK: 0.85,
      TIKTOK: 0.65,
      YOUTUBE: 0.75,
    },
  },
  {
    name: "Myth Buster",
    description:
      "Challenges a common belief or popular advice to create intrigue through contrarian thinking.",
    examples: [
      "\"Post consistently\" is terrible advice. Here's what to do instead.",
      "Everything you've been told about hashtags is wrong.",
      "The #1 marketing myth that's killing your growth.",
    ],
    platformAffinity: {
      TWITTER: 0.9,
      INSTAGRAM: 0.7,
      FACEBOOK: 0.7,
      TIKTOK: 0.8,
      YOUTUBE: 0.85,
    },
  },
  {
    name: "Quick Win",
    description:
      "Promises an immediate, actionable takeaway that delivers fast results.",
    examples: [
      "Change this one setting and double your reach today.",
      "A 30-second tweak that makes every caption 10x better.",
      "Do this before your next post — it takes 2 minutes.",
    ],
    platformAffinity: {
      TWITTER: 0.85,
      INSTAGRAM: 0.75,
      FACEBOOK: 0.7,
      TIKTOK: 0.9,
      YOUTUBE: 0.7,
    },
  },
  {
    name: "FOMO",
    description:
      "Creates urgency or fear of missing out to drive immediate action or attention.",
    examples: [
      "If you're not doing this in 2025, you're already behind.",
      "This trend is about to explode — and early movers win.",
    ],
    platformAffinity: {
      TWITTER: 0.8,
      INSTAGRAM: 0.75,
      FACEBOOK: 0.7,
      TIKTOK: 0.85,
      YOUTUBE: 0.7,
    },
  },
];

/**
 * Select 3-4 hooks weighted by platform affinity, optimization goal, and account type.
 */
export function selectHooks(
  platform: Platform,
  optimizationGoal: OptimizationGoal,
  accountType: AccountType
): HookFramework[] {
  const goalBoosts = GOAL_BOOSTS[optimizationGoal];
  const accountBoosts = ACCOUNT_TYPE_BOOSTS[accountType];

  const scored = HOOK_FRAMEWORKS.map((hook) => {
    const platformScore = hook.platformAffinity[platform];
    const goalBoost = goalBoosts[hook.name] ?? 0;
    const accountBoost = accountBoosts[hook.name] ?? 0;
    const total = platformScore + goalBoost + accountBoost;
    return { hook, score: total };
  });

  scored.sort((a, b) => b.score - a.score);

  // Return top 3 always, plus 4th if its score is close to 3rd (within 0.15)
  // Safe: HOOK_FRAMEWORKS has 10 entries, so top always has 4 elements
  const top = scored.slice(0, 4);
  const thirdScore = top[2].score;
  const fourthScore = top[3].score;

  if (fourthScore >= thirdScore - 0.15) {
    return top.map((s) => s.hook);
  }

  return top.slice(0, 3).map((s) => s.hook);
}

/**
 * Build a complete prompt section instructing Claude to use diverse hook types.
 *
 * Hybrid approach: includes ALL hook types as reference, but explicitly recommends
 * contextually preferred hooks and enforces diversity across briefs.
 */
export function buildHookInstructions(
  platforms: Platform[],
  optimizationGoal: OptimizationGoal,
  accountType: AccountType
): string {
  // Collect preferred hooks across all platforms (deduplicated)
  const preferredNames = new Set<string>();
  for (const platform of platforms) {
    const selected = selectHooks(platform, optimizationGoal, accountType);
    for (const hook of selected) {
      preferredNames.add(hook.name);
    }
  }

  const hookReference = HOOK_FRAMEWORKS.map(
    (h) =>
      `- **${h.name}**: ${h.description}\n  Examples: ${h.examples.map((e) => `"${e}"`).join("; ")}`
  ).join("\n");

  const preferredList = Array.from(preferredNames).join(", ");

  return `## Hook Frameworks

Use diverse hook types to keep content fresh and engaging. Below are 10 proven hook frameworks — vary your selection across briefs.

${hookReference}

### Preferred Hooks for This Context
Based on the target platforms, optimization goal (${optimizationGoal}), and account type (${accountType}), prioritize these hooks: **${preferredList}**.

### Diversity Rules
- Ensure at least 3 different hook types across briefs in a batch.
- Do not use the same hook type for consecutive briefs.
- Vary between emotional (Pattern Interrupt, FOMO, Before/After Bridge) and rational (Educational, Authority Builder, Quick Win) hooks.
- When in doubt, prefer the recommended hooks above but still rotate through others for variety.`;
}
