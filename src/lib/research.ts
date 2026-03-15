/**
 * Research Pipeline — invoked by AWS EventBridge Lambda every 4 hours.
 *
 * For each active workspace with a ContentStrategy:
 *   1. Fetch research data from configured sources (RSS, Reddit, Google Trends)
 *   2. Send to Claude for thematic synthesis
 *   3. Store ResearchSummary record
 */
import { parseStringPromise } from "xml2js";
import { prisma } from "@/lib/db";
import { env } from "@/env";
import { synthesizeResearch } from "@/lib/ai/research";
import { reportServerError } from "@/lib/server-error-reporter";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import {
  mockFetchRssFeeds,
  mockFetchRedditSubreddits,
  mockFetchGoogleTrends,
} from "@/lib/mocks/research";

// ── Types ────────────────────────────────────────────────────────────────────

interface ResearchItem {
  source: string;
  title: string;
  url?: string;
  snippet?: string;
  score?: number;
  publishedAt?: string;
}

interface ResearchSourcesConfig {
  rssFeeds?: string[];
  subreddits?: string[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const RSS_TIMEOUT_MS = 10_000;
const RSS_RATE_DELAY_MS = 500;
const REDDIT_RATE_DELAY_MS = 1_000;
const MAX_ITEMS_PER_SOURCE = 15;
const WALL_CLOCK_BUFFER_MS = 30_000; // bail if < 30s remaining

// ── RSS fetching ─────────────────────────────────────────────────────────────

const RSS_USER_AGENT = "AISocial/1.0 (content-research-bot)";

interface ParsedFeedItem {
  title?: string;
  link?: string;
  snippet?: string;
  pubDate?: string;
}

/** Parse RSS 2.0 or Atom XML into a uniform item list */
async function parseRssXml(xml: string): Promise<ParsedFeedItem[]> {
  const result = await parseStringPromise(xml, { explicitArray: false, trim: true });

  // RSS 2.0: result.rss.channel.item
  if (result.rss?.channel) {
    const channel = result.rss.channel;
    const rawItems = channel.item
      ? Array.isArray(channel.item) ? channel.item : [channel.item]
      : [];
    return rawItems.map((item: Record<string, string>) => ({
      title: item.title,
      link: item.link,
      snippet: item.description || item["content:encoded"],
      pubDate: item.pubDate,
    }));
  }

  // Atom: result.feed.entry
  if (result.feed?.entry) {
    const rawEntries = Array.isArray(result.feed.entry) ? result.feed.entry : [result.feed.entry];
    return rawEntries.map((entry: Record<string, unknown>) => ({
      title: typeof entry.title === "string" ? entry.title : (entry.title as Record<string, string>)?._,
      link: typeof entry.link === "string" ? entry.link : (entry.link as Record<string, Record<string, string>>)?.$?.href,
      snippet: typeof entry.summary === "string" ? entry.summary : (entry.summary as Record<string, string>)?._,
      pubDate: (entry.updated ?? entry.published) as string | undefined,
    }));
  }

  return [];
}

/** Block private IPs + localhost to prevent SSRF via user-configured RSS feeds */
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    // Block common private/internal hostnames
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("169.254.") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }
    // Block 172.16-31.x.x range
    const match172 = hostname.match(/^172\.(\d+)\./);
    if (match172 && parseInt(match172[1]) >= 16 && parseInt(match172[1]) <= 31) {
      return false;
    }
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Strip HTML tags from RSS content to prevent prompt injection via markup */
function sanitizeText(text: string | undefined): string {
  if (!text) return "";
  return text.replace(/<[^>]*>/g, "").trim();
}

async function fetchRssFeeds(feeds: string[]): Promise<ResearchItem[]> {
  const items: ResearchItem[] = [];
  for (const feedUrl of feeds) {
    if (!isSafeUrl(feedUrl)) {
      console.warn(`Skipping unsafe RSS URL: ${feedUrl}`);
      continue;
    }
    try {
      const response = await fetch(feedUrl, {
        headers: { "User-Agent": RSS_USER_AGENT },
        signal: AbortSignal.timeout(RSS_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.error(`RSS feed returned ${response.status}: ${feedUrl}`);
        continue;
      }
      const xml = await response.text();
      const feedItems = await parseRssXml(xml);
      for (const item of feedItems.slice(0, MAX_ITEMS_PER_SOURCE)) {
        items.push({
          source: "rss",
          title: sanitizeText(item.title),
          url: item.link,
          snippet: sanitizeText(item.snippet)?.slice(0, 500),
          publishedAt: item.pubDate,
        });
      }
    } catch (err) {
      console.error(`Failed to fetch RSS feed ${feedUrl}:`, err);
    }
    // Rate limit between feeds
    await new Promise((r) => setTimeout(r, RSS_RATE_DELAY_MS));
  }
  return items;
}

// ── Reddit fetching ──────────────────────────────────────────────────────────

let redditToken: { accessToken: string; expiresAt: number } | null = null;

async function getRedditToken(): Promise<string | null> {
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) return null;

  if (redditToken && redditToken.expiresAt > Date.now() + 60_000) {
    return redditToken.accessToken;
  }

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "AISocial/1.0 (content-research-bot)",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    console.error(`Reddit OAuth failed: ${response.status}`);
    return null;
  }

  const data = await response.json();
  redditToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return redditToken.accessToken;
}

async function fetchRedditSubreddits(subreddits: string[]): Promise<ResearchItem[]> {
  const token = await getRedditToken();
  const items: ResearchItem[] = [];

  for (const sub of subreddits) {
    const subreddit = sub.replace(/^r\//, "");
    try {
      const url = token
        ? `https://oauth.reddit.com/r/${subreddit}/hot?limit=${MAX_ITEMS_PER_SOURCE}&t=day`
        : `https://www.reddit.com/r/${subreddit}/hot.json?limit=${MAX_ITEMS_PER_SOURCE}&t=day`;

      const headers: Record<string, string> = {
        "User-Agent": "AISocial/1.0 (content-research-bot)",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(url, { headers });
      if (response.status === 429) {
        console.warn(`Reddit rate limited for r/${subreddit}`);
        continue;
      }
      if (!response.ok) continue;

      const data = await response.json();
      for (const child of data.data?.children ?? []) {
        const post = child.data;
        items.push({
          source: "reddit",
          title: sanitizeText(post.title),
          url: `https://reddit.com${post.permalink}`,
          snippet: sanitizeText(post.selftext)?.slice(0, 500),
          score: post.score,
          publishedAt: new Date(post.created_utc * 1000).toISOString(),
        });
      }
    } catch (err) {
      console.error(`Failed to fetch r/${subreddit}:`, err);
    }
    await new Promise((r) => setTimeout(r, REDDIT_RATE_DELAY_MS));
  }
  return items;
}

// ── Google Trends (via SerpAPI, optional) ─────────────────────────────────────

async function fetchGoogleTrends(industry: string): Promise<ResearchItem[]> {
  if (!env.SERPAPI_KEY) return [];

  try {
    const params = new URLSearchParams({
      engine: "google_trends",
      q: industry,
      api_key: env.SERPAPI_KEY,
      data_type: "TIMESERIES",
      date: "now 7-d",
    });

    const response = await fetch(`https://serpapi.com/search?${params}`);
    if (!response.ok) return [];

    const data = await response.json();
    const relatedQueries = data.related_queries?.rising ?? [];
    return relatedQueries.slice(0, MAX_ITEMS_PER_SOURCE).map(
      (q: { query: string; value: number }) => ({
        source: "google_trends",
        title: sanitizeText(q.query),
        score: q.value,
      })
    );
  } catch (err) {
    console.error("Failed to fetch Google Trends:", err);
    return [];
  }
}

// ── Main pipeline ────────────────────────────────────────────────────────────

export async function runResearchPipeline(
  deadlineMs?: number
): Promise<{ processed: number }> {
  const deadline = deadlineMs ?? Date.now() + 4.5 * 60_000;

  // Fetch workspaces with an active ContentStrategy
  const workspaces = await prisma.business.findMany({
    where: { contentStrategy: { isNot: null } },
    include: { contentStrategy: true },
  });

  let processed = 0;

  for (const workspace of workspaces) {
    // Wall-clock budgeting: bail if not enough time
    if (Date.now() > deadline - WALL_CLOCK_BUFFER_MS) {
      console.warn(`Research pipeline: bailing early, ${workspaces.length - processed} workspaces remaining`);
      break;
    }

    const strategy = workspace.contentStrategy;
    if (!strategy) continue;

    try {
      const sources = (strategy.researchSources as ResearchSourcesConfig) ?? {};
      const sourcesUsed: string[] = [];

      // Fetch from all configured sources
      const allItems: ResearchItem[] = [];
      const useMocks = shouldMockExternalApis();

      // RSS feeds
      if (sources.rssFeeds?.length) {
        const rssItems = useMocks
          ? mockFetchRssFeeds()
          : await fetchRssFeeds(sources.rssFeeds);
        allItems.push(...rssItems);
        if (rssItems.length > 0) sourcesUsed.push("rss");
      }

      // Reddit
      if (sources.subreddits?.length) {
        const redditItems = useMocks
          ? mockFetchRedditSubreddits()
          : await fetchRedditSubreddits(sources.subreddits);
        allItems.push(...redditItems);
        if (redditItems.length > 0) sourcesUsed.push("reddit");
      }

      // Google Trends
      const trendItems = useMocks
        ? mockFetchGoogleTrends()
        : await fetchGoogleTrends(strategy.industry);
      allItems.push(...trendItems);
      if (trendItems.length > 0) sourcesUsed.push("google_trends");

      if (allItems.length === 0) {
        console.warn(`No research items found for workspace ${workspace.id}`);
        continue;
      }

      // Format items for Claude synthesis
      const formattedItems = allItems
        .map(
          (item) =>
            `[${item.source}] ${item.title}${item.snippet ? `: ${item.snippet}` : ""}${item.score ? ` (score: ${item.score})` : ""}`
        )
        .join("\n");

      // Claude synthesis
      const synthesis = await synthesizeResearch(
        strategy.industry,
        strategy.targetAudience,
        strategy.contentPillars,
        formattedItems
      );

      // Store ResearchSummary
      await prisma.researchSummary.create({
        data: {
          businessId: workspace.id,
          sourceItems: JSON.parse(JSON.stringify(allItems)),
          synthesizedThemes: JSON.stringify(synthesis),
          sourcesUsed,
        },
      });

      processed++;
    } catch (err) {
      console.error(`Research pipeline failed for workspace ${workspace.id}:`, err);
      await reportServerError(
        `Research pipeline failed for workspace ${workspace.id}: ${err instanceof Error ? err.message : String(err)}`,
        {
          url: "cron/research",
          metadata: { workspaceId: workspace.id, source: "research-pipeline" },
        }
      ).catch(() => {});
      // Continue with next workspace
    }
  }

  return { processed };
}
