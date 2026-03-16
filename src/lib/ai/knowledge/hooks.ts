/**
 * Hook frameworks knowledge module.
 *
 * Exports the 10 proven hook types (validated by Blotato / industry research)
 * with metadata, platform affinity scores, and selection/prompt-building helpers.
 */

export type Platform = "TWITTER" | "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "YOUTUBE";
export type OptimizationGoal = "ENGAGEMENT" | "REACH" | "CONVERSIONS" | "BRAND_AWARENESS";
export type AccountType = "BUSINESS" | "INFLUENCER" | "MEME";

export interface HookFramework {
  /** Human-readable hook name */
  name: string;
  /** Short description of the technique */
  description: string;
  /** 2-3 example opener lines */
  examples: string[];
  /** Platform affinity scores (0-1), higher = better fit */
  platformAffinity: Record<Platform, number>;
}

export const HOOK_FRAMEWORKS: HookFramework[] = [
  {
    name: "Pattern Interrupt",
    description:
      "Opens with something unexpected that breaks the scroll pattern — a surprising stat, contradiction, or unconventional statement.",
    examples: [
      "Stop scrolling. This changed everything about how I work.",
      "I deleted 10,000 followers on purpose. Here's why.",
      "The worst advice I ever got made me successful.",
    ],
    platformAffinity: {
      TWITTER: 0.9,
      INSTAGRAM: 0.8,
      FACEBOOK: 0.6,
      TIKTOK: 1.0,
      YOUTUBE: 0.7,
    },
  },
  {
    name: "Authority Builder",
    description:
      "Leads with credibility — credentials, experience, or results that establish the author as a trusted source.",
    examples: [
      "After 10 years of building startups, here's what actually matters.",
      "I've managed $50M in ad spend. Most brands waste money on this.",
    ],
    platformAffinity: {
      TWITTER: 0.8,
      INSTAGRAM: 0.6,
      FACEBOOK: 0.7,
      TIKTOK: 0.5,
      YOUTUBE: 0.9,
    },
  },
  {
    name: "Problem-Agitate-Solution",
    description:
      "Names a problem the audience faces, amplifies the pain, then hints at or delivers the solution.",
    examples: [
      "Struggling to get engagement? You're probably making this one mistake.",
      "Your content isn't bad — your timing is. Here's the fix.",
      "Tired of posting into the void? This framework changes everything.",
    ],
    platformAffinity: {
      TWITTER: 0.8,
      INSTAGRAM: 0.7,
      FACEBOOK: 0.8,
      TIKTOK: 0.7,
      YOUTUBE: 0.9,
    },
  },
  {
    name: "Hidden Secret",
    description:
      "Creates curiosity by teasing insider knowledge, little-known facts, or unconventional approaches.",
    examples: [
      "The algorithm hack nobody talks about.",
      "There's a feature in your phone you've never used. It's a game-changer.",
      "What top creators won't tell you about growth.",
    ],
    platformAffinity: {
      TWITTER: 0.7,
      INSTAGRAM: 0.8,
      FACEBOOK: 0.6,
      TIKTOK: 0.9,
      YOUTUBE: 0.8,
    },
  },
  {
    name: "Before/After Bridge",
    description:
      "Shows transformation — contrasts the 'before' state with the 'after' to make the value immediately visible.",
    examples: [
      "6 months ago I had 200 followers. Today I have 50K. Here's exactly what changed.",
      "My mornings used to be chaos. Now they're my superpower.",
    ],
    platformAffinity: {
      TWITTER: 0.7,
      INSTAGRAM: 0.9,
      FACEBOOK: 0.7,
      TIKTOK: 0.8,
      YOUTUBE: 0.8,
    },
  },
  {
    name: "Educational",
    description:
      "Leads with a clear promise to teach — numbered lists, how-tos, or frameworks that signal value upfront.",
    examples: [
      "5 things I wish I knew before starting a business.",
      "How to write a viral tweet in 3 steps.",
      "The framework behind every successful product launch.",
    ],
    platformAffinity: {
      TWITTER: 0.9,
      INSTAGRAM: 0.7,
      FACEBOOK: 0.8,
      TIKTOK: 0.6,
      YOUTUBE: 1.0,
    },
  },
  {
    name: "Social Proof",
    description:
      "Opens with evidence of popularity, testimonials, or crowd validation to trigger bandwagon effect.",
    examples: [
      "10,000 people downloaded this template last week. Here's why.",
      "Every founder I know swears by this one tool.",
    ],
    platformAffinity: {
      TWITTER: 0.7,
      INSTAGRAM: 0.8,
      FACEBOOK: 0.9,
      TIKTOK: 0.6,
      YOUTUBE: 0.7,
    },
  },
  {
    name: "Myth Buster",
    description:
      "Challenges conventional wisdom or popular beliefs to create cognitive dissonance and curiosity.",
    examples: [
      "\"Post every day\" is terrible advice. Here's what to do instead.",
      "You don't need a morning routine to be productive.",
      "Everything you know about SEO is wrong.",
    ],
    platformAffinity: {
      TWITTER: 0.9,
      INSTAGRAM: 0.7,
      FACEBOOK: 0.7,
      TIKTOK: 0.8,
      YOUTUBE: 0.9,
    },
  },
  {
    name: "Quick Win",
    description:
      "Promises an immediate, easy-to-implement result — low effort, high perceived value.",
    examples: [
      "Do this one thing today and double your engagement.",
      "A 2-minute fix that makes your profile 10x more professional.",
      "Copy this template — it works every time.",
    ],
    platformAffinity: {
      TWITTER: 0.8,
      INSTAGRAM: 0.8,
      FACEBOOK: 0.7,
      TIKTOK: 0.9,
      YOUTUBE: 0.7,
    },
  },
  {
    name: "FOMO",
    description:
      "Creates urgency or fear of missing out — time-sensitive, exclusive, or trending content.",
    examples: [
      "Everyone's talking about this and you're missing it.",
      "This trend is about to explode. Get in now.",
    ],
    platformAffinity: {
      TWITTER: 0.7,
      INSTAGRAM: 0.9,
      FACEBOOK: 0.7,
      TIKTOK: 1.0,
      YOUTUBE: 0.6,
    },
  },
];

/** Weight multipliers for optimization goals per hook */
const GOAL_WEIGHTS: Record<OptimizationGoal, Record<string, number>> = {
  ENGAGEMENT: {
    "Pattern Interrupt": 1.3,
    "Problem-Agitate-Solution": 1.2,
    "Myth Buster": 1.2,
    "Quick Win": 1.1,
    FOMO: 1.1,
  },
  REACH: {
    "Pattern Interrupt": 1.3,
    Educational: 1.2,
    "Myth Buster": 1.1,
    "Hidden Secret": 1.2,
    FOMO: 1.2,
  },
  CONVERSIONS: {
    "Problem-Agitate-Solution": 1.4,
    "Social Proof": 1.3,
    "Authority Builder": 1.2,
    "Before/After Bridge": 1.3,
    "Quick Win": 1.1,
  },
  BRAND_AWARENESS: {
    "Authority Builder": 1.3,
    Educational: 1.3,
    "Social Proof": 1.2,
    "Before/After Bridge": 1.1,
    "Hidden Secret": 1.1,
  },
};

/** Weight multipliers for account types per hook */
const ACCOUNT_TYPE_WEIGHTS: Record<AccountType, Record<string, number>> = {
  BUSINESS: {
    "Authority Builder": 1.3,
    Educational: 1.2,
    "Problem-Agitate-Solution": 1.2,
    "Social Proof": 1.1,
  },
  INFLUENCER: {
    "Before/After Bridge": 1.3,
    "Hidden Secret": 1.2,
    "Pattern Interrupt": 1.1,
    "Social Proof": 1.2,
  },
  MEME: {
    "Pattern Interrupt": 1.4,
    "Myth Buster": 1.3,
    FOMO: 1.2,
    "Quick Win": 1.1,
  },
};

/**
 * Select the 3-4 most contextually relevant hooks for the given platform,
 * optimization goal, and account type.
 *
 * Scoring: platformAffinity * goalWeight * accountTypeWeight, then top 3-4.
 * Returns 4 hooks when the top scores are closely bunched, otherwise 3.
 */
export function selectHooks(
  platform: Platform,
  optimizationGoal: OptimizationGoal,
  accountType: AccountType
): HookFramework[] {
  const goalWeights = GOAL_WEIGHTS[optimizationGoal];
  const typeWeights = ACCOUNT_TYPE_WEIGHTS[accountType];

  const scored = HOOK_FRAMEWORKS.map((hook) => {
    const platformScore = hook.platformAffinity[platform];
    const goalMultiplier = goalWeights[hook.name] ?? 1.0;
    const typeMultiplier = typeWeights[hook.name] ?? 1.0;
    const score = platformScore * goalMultiplier * typeMultiplier;
    return { hook, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Return 4 if the 4th score is within 15% of the 3rd, otherwise 3
  const thirdScore = scored[2].score;
  const fourthScore = scored[3].score;
  const count = fourthScore >= thirdScore * 0.85 ? 4 : 3;

  return scored.slice(0, count).map((s) => s.hook);
}

/**
 * Build a complete prompt section instructing Claude to use diverse hook types
 * across a batch of briefs.
 *
 * Includes all 10 hook types for reference but highlights the contextually
 * recommended ones and enforces diversity.
 */
export function buildHookInstructions(
  platforms: Platform[],
  optimizationGoal: OptimizationGoal,
  accountType: AccountType
): string {
  // Collect recommended hooks across all platforms (union, deduplicated)
  const recommendedSet = new Set<string>();
  for (const platform of platforms) {
    const selected = selectHooks(platform, optimizationGoal, accountType);
    for (const hook of selected) {
      recommendedSet.add(hook.name);
    }
  }
  const recommended = Array.from(recommendedSet);

  // Build the reference section with all hooks
  const hookReference = HOOK_FRAMEWORKS.map((hook) => {
    const examples = hook.examples.map((ex) => `  - "${ex}"`).join("\n");
    return `**${hook.name}**: ${hook.description}\nExamples:\n${examples}`;
  }).join("\n\n");

  return `## Hook Frameworks

Use diverse hook types to keep content fresh and engaging. Each brief should open with a compelling hook.

### Available Hook Types

${hookReference}

### Recommended Hooks for This Context

Prioritize these hook types based on the target platforms, ${optimizationGoal.toLowerCase().replace("_", " ")} goal, and ${accountType.toLowerCase()} account style:
${recommended.map((name) => `- ${name}`).join("\n")}

### Diversity Rules

- Ensure at least 3 different hook types across briefs in a batch.
- Vary your openers — do not use the same hook type for consecutive briefs.
- Prefer the recommended hooks above, but include others for variety when generating 4+ briefs.`;
}
