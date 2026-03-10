/**
 * Mock data for research pipeline external calls.
 * Covers RSS feeds, Reddit API, and Google Trends (SerpAPI).
 */

interface ResearchItem {
  source: string;
  title: string;
  url?: string;
  snippet?: string;
  score?: number;
  publishedAt?: string;
}

export function mockFetchRssFeeds(): ResearchItem[] {
  const now = new Date();
  return [
    {
      source: "rss",
      title: "[MOCK] AI Industry Sees Record Investment in Q1",
      url: "https://example.com/mock-article-1",
      snippet:
        "Venture capital funding for AI startups reached $12B in the first quarter, driven by enterprise adoption of generative AI tools.",
      publishedAt: new Date(now.getTime() - 2 * 3600_000).toISOString(),
    },
    {
      source: "rss",
      title: "[MOCK] Remote Work Trends: What 2026 Looks Like",
      url: "https://example.com/mock-article-2",
      snippet:
        "Survey of 5,000 workers reveals shifting attitudes toward hybrid work, with productivity metrics challenging traditional office assumptions.",
      publishedAt: new Date(now.getTime() - 5 * 3600_000).toISOString(),
    },
    {
      source: "rss",
      title: "[MOCK] Sustainable Tech: Green Computing Goes Mainstream",
      url: "https://example.com/mock-article-3",
      snippet:
        "Major cloud providers announce carbon-neutral data center initiatives, signaling a shift in how the industry approaches environmental responsibility.",
      publishedAt: new Date(now.getTime() - 8 * 3600_000).toISOString(),
    },
  ];
}

export function mockFetchRedditSubreddits(): ResearchItem[] {
  const now = new Date();
  return [
    {
      source: "reddit",
      title: "[MOCK] What tools are you using to automate your social media in 2026?",
      url: "https://reddit.com/r/socialmedia/comments/mock1",
      snippet:
        "Looking for recommendations on scheduling and analytics tools. Currently using Buffer but exploring alternatives.",
      score: 247,
      publishedAt: new Date(now.getTime() - 3 * 3600_000).toISOString(),
    },
    {
      source: "reddit",
      title: "[MOCK] Case study: How we grew from 1K to 50K followers in 6 months",
      url: "https://reddit.com/r/marketing/comments/mock2",
      snippet:
        "Detailed breakdown of our content strategy, posting cadence, and engagement tactics that drove organic growth.",
      score: 892,
      publishedAt: new Date(now.getTime() - 6 * 3600_000).toISOString(),
    },
  ];
}

export function mockFetchGoogleTrends(): ResearchItem[] {
  return [
    { source: "google_trends", title: "[MOCK] ai content creation", score: 100 },
    { source: "google_trends", title: "[MOCK] social media automation", score: 85 },
    { source: "google_trends", title: "[MOCK] brand authenticity", score: 72 },
    { source: "google_trends", title: "[MOCK] short form video strategy", score: 68 },
  ];
}
