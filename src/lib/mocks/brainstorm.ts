/**
 * Mock data for brainstorm generation.
 * Returns realistic responses without hitting external APIs.
 */
import type { BrainstormOutput } from "@/lib/brainstorm/types";

let mockIssueCounter = 200;

const MOCK_OUTPUT: BrainstormOutput = {
  projectSummary:
    "[MOCK] A social media management platform with AI-powered content strategy, " +
    "multi-platform publishing via Blotato, and autonomous scheduling. " +
    "Currently in Phase 2 with 15 open issues and 8 recently merged PRs.",
  researchInsights:
    "[MOCK] Market analysis shows growing demand for AI-native social tools. " +
    "Competitors are adding AI content generation but few offer end-to-end autonomous pipelines. " +
    "Analytics integration remains a key differentiator.",
  items: [
    {
      title: "Smart Hashtag Recommendations",
      rationale:
        "Hashtag performance varies significantly across platforms. AI-driven suggestions based on content analysis and trending data could boost reach by 20-40%.",
      scope: "Medium",
      visionAlignment: "Enhances the autonomous content pipeline with smarter distribution.",
      category: "Intelligence",
    },
    {
      title: "Bulk Content Import",
      rationale:
        "Users migrating from other tools need a way to import existing content. CSV/JSON import would reduce onboarding friction.",
      scope: "Small",
      visionAlignment: "Lowers barrier to adoption for new users.",
      category: "UX",
    },
    {
      title: "Rate Limit Dashboard",
      rationale:
        "Platform API rate limits are a common pain point. A dashboard showing current usage and limits would prevent publishing failures.",
      scope: "Small",
      visionAlignment: "Improves operational reliability and transparency.",
      category: "Operations",
    },
    {
      title: "A/B Testing Framework",
      rationale:
        "Enable testing multiple content variants to optimize engagement. Start with caption variants, expand to timing and format.",
      scope: "Large",
      visionAlignment: "Core to the data-driven optimization strategy.",
      category: "Growth",
    },
    {
      title: "CDN Edge Caching for Media",
      rationale:
        "Media assets are served directly from S3. Adding CloudFront caching would reduce latency and costs for repeated access.",
      scope: "Medium",
      visionAlignment: "Infrastructure scalability for growing media library.",
      category: "Infrastructure",
    },
  ],
};

export function mockGenerateBrainstorm(): {
  issueNumber: number;
  url: string;
} {
  const number = ++mockIssueCounter;
  return {
    issueNumber: number,
    url: `https://github.com/mock-owner/mock-repo/issues/${number}`,
  };
}

/** Exposed for tests that need the raw output shape. */
export function getMockBrainstormOutput(): BrainstormOutput {
  return { ...MOCK_OUTPUT, items: [...MOCK_OUTPUT.items] };
}
