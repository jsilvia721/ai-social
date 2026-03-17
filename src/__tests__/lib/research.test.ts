// Mock Anthropic SDK before any module that uses it loads
const anthropicCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Mock AI models module
jest.mock("@/lib/ai/models", () => ({
  getAnthropicClient: jest.fn(() => ({
    messages: { create: (...args: unknown[]) => anthropicCreate(...args) },
  })),
  getModel: jest.fn((tier: string) =>
    tier === "fast" ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6"
  ),
  MODEL_DEFAULT: "claude-sonnet-4-6",
  MODEL_FAST: "claude-haiku-4-5-20251001",
}));

// Mock error reporter
const mockReportServerError = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/server-error-reporter", () => ({
  reportServerError: (...args: unknown[]) => mockReportServerError(...args),
}));

import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
jest.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { runResearchPipeline } from "@/lib/research";
import { synthesizeResearch } from "@/lib/ai/research";

beforeEach(() => {
  resetPrismaMock();
  anthropicCreate.mockReset();
  mockReportServerError.mockReset().mockResolvedValue(undefined);
  jest.restoreAllMocks();
});

// ── synthesizeResearch tests ────────────────────────────────────────────────

describe("synthesizeResearch", () => {
  const validSynthesis = {
    themes: [
      {
        title: "AI in Content Marketing",
        summary: "AI tools are reshaping how brands create content.",
        relevanceScore: 0.85,
        suggestedAngles: ["How-to guide for AI tools", "Case study breakdown"],
      },
    ],
    overallSummary: "The content landscape is shifting toward AI-assisted creation.",
  };

  it("calls Claude with correct tool_choice and returns parsed result", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "synthesize_themes", input: validSynthesis }],
    });

    const result = await synthesizeResearch(
      "Marketing",
      "Small business owners",
      ["AI", "Content"],
      "[rss] Some article: snippet"
    );

    expect(result).toEqual(validSynthesis);
    expect(anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.any(String),
        tool_choice: { type: "tool", name: "synthesize_themes" },
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "synthesize_themes" }),
        ]),
      })
    );
  });

  it("includes industry, audience, and pillars in the prompt", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "synthesize_themes", input: validSynthesis }],
    });

    await synthesizeResearch("Fintech", "CFOs", ["Compliance", "Automation"], "data");

    const call = anthropicCreate.mock.calls[0][0];
    const userMessage = call.messages[0].content as string;
    expect(userMessage).toContain("Fintech");
    expect(userMessage).toContain("CFOs");
    expect(userMessage).toContain("Compliance");
    expect(userMessage).toContain("Automation");
  });

  it("includes prompt injection defense in system prompt", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "synthesize_themes", input: validSynthesis }],
    });

    await synthesizeResearch("Tech", "Devs", ["Code"], "data");

    const call = anthropicCreate.mock.calls[0][0];
    expect(call.system).toContain("untrusted");
  });

  it("throws when Claude does not call the tool", async () => {
    anthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "I cannot do that" }],
    });

    await expect(
      synthesizeResearch("Tech", "Devs", ["Code"], "data")
    ).rejects.toThrow("Claude did not call synthesize_themes");
  });

  it("throws on invalid tool output (Zod validation)", async () => {
    anthropicCreate.mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "synthesize_themes",
          input: { themes: [], overallSummary: "test" }, // themes.min(1) fails
        },
      ],
    });

    await expect(
      synthesizeResearch("Tech", "Devs", ["Code"], "data")
    ).rejects.toThrow();
  });
});

// ── XML fixtures ────────────────────────────────────────────────────────────

function rss20Xml(items: { title: string; link: string; description: string; pubDate?: string }[]): string {
  const itemsXml = items.map(i => `
    <item>
      <title>${i.title}</title>
      <link>${i.link}</link>
      <description>${i.description}</description>
      ${i.pubDate ? `<pubDate>${i.pubDate}</pubDate>` : ""}
    </item>`).join("");
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test Feed</title>${itemsXml}</channel></rss>`;
}

function atomXml(entries: { title: string; link: string; summary: string; updated?: string }[]): string {
  const entriesXml = entries.map(e => `
    <entry>
      <title>${e.title}</title>
      <link href="${e.link}" />
      <summary>${e.summary}</summary>
      ${e.updated ? `<updated>${e.updated}</updated>` : ""}
    </entry>`).join("");
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Test Feed</title>${entriesXml}</feed>`;
}

function mockFetchXml(xml: string) {
  return {
    ok: true,
    text: async () => xml,
  };
}

// ── runResearchPipeline tests ───────────────────────────────────────────────

describe("runResearchPipeline", () => {
  const mockWorkspace = {
    id: "biz-1",
    name: "Test Biz",
    contentStrategy: {
      id: "cs-1",
      businessId: "biz-1",
      industry: "Marketing",
      targetAudience: "SMBs",
      contentPillars: ["AI", "Growth"],
      researchSources: { rssFeeds: ["https://example.com/feed.xml"] },
    },
  };

  const validSynthesis = {
    themes: [
      {
        title: "Test Theme",
        summary: "Test summary",
        relevanceScore: 0.8,
        suggestedAngles: ["Angle 1"],
      },
    ],
    overallSummary: "Test overall",
  };

  beforeEach(() => {
    // Default: no fetch calls succeed
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("unmocked fetch"));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns { processed: 0 } when no workspaces have strategies", async () => {
    prismaMock.business.findMany.mockResolvedValue([]);

    const result = await runResearchPipeline(Date.now() + 60_000);

    expect(result).toEqual({ processed: 0 });
  });

  it("processes workspace with RSS 2.0 feeds", async () => {
    prismaMock.business.findMany.mockResolvedValue([mockWorkspace] as any);

    const xml = rss20Xml([
      { title: "Article 1", link: "https://example.com/1", description: "Snippet 1", pubDate: "Sat, 01 Mar 2026 00:00:00 GMT" },
      { title: "Article 2", link: "https://example.com/2", description: "Snippet 2", pubDate: "Mon, 02 Mar 2026 00:00:00 GMT" },
    ]);
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchXml(xml));

    // Mock Claude synthesis
    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "synthesize_themes", input: validSynthesis }],
    });

    prismaMock.researchSummary.create.mockResolvedValue({ id: "rs-1" } as any);

    const result = await runResearchPipeline(Date.now() + 60_000);

    expect(result).toEqual({ processed: 1 });
    expect(prismaMock.researchSummary.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: "biz-1",
        sourcesUsed: expect.arrayContaining(["rss"]),
      }),
    });
  });

  it("processes workspace with Atom feeds", async () => {
    prismaMock.business.findMany.mockResolvedValue([mockWorkspace] as any);

    const xml = atomXml([
      { title: "Atom Article 1", link: "https://example.com/atom/1", summary: "Atom snippet", updated: "2026-03-01T00:00:00Z" },
    ]);
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchXml(xml));

    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "synthesize_themes", input: validSynthesis }],
    });
    prismaMock.researchSummary.create.mockResolvedValue({ id: "rs-1" } as any);

    const result = await runResearchPipeline(Date.now() + 60_000);

    expect(result).toEqual({ processed: 1 });
    const createCall = prismaMock.researchSummary.create.mock.calls[0][0];
    const sourceItems = createCall.data.sourceItems as any[];
    expect(sourceItems[0].title).toBe("Atom Article 1");
    expect(sourceItems[0].url).toBe("https://example.com/atom/1");
  });

  it("skips unsafe RSS URLs", async () => {
    const workspaceWithUnsafeFeeds = {
      ...mockWorkspace,
      contentStrategy: {
        ...mockWorkspace.contentStrategy,
        researchSources: {
          rssFeeds: [
            "https://localhost/feed",
            "https://192.168.1.1/feed",
            "https://10.0.0.1/feed",
            "http://169.254.169.254/latest/meta-data",
            "https://internal.local/feed",
          ],
        },
      },
    };
    prismaMock.business.findMany.mockResolvedValue([workspaceWithUnsafeFeeds] as any);

    const result = await runResearchPipeline(Date.now() + 60_000);

    expect(result).toEqual({ processed: 0 });
    // fetch should not have been called for unsafe URLs
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("skips workspace when no research items are found", async () => {
    const workspaceNoSources = {
      ...mockWorkspace,
      contentStrategy: {
        ...mockWorkspace.contentStrategy,
        researchSources: {},
      },
    };
    prismaMock.business.findMany.mockResolvedValue([workspaceNoSources] as any);

    const result = await runResearchPipeline(Date.now() + 60_000);

    expect(result).toEqual({ processed: 0 });
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("bails early when deadline approaches", async () => {
    prismaMock.business.findMany.mockResolvedValue([
      mockWorkspace,
      { ...mockWorkspace, id: "biz-2" },
    ] as any);

    // Set deadline to already passed
    const result = await runResearchPipeline(Date.now() - 1000);

    expect(result).toEqual({ processed: 0 });
  });

  it("continues processing other workspaces when one fails", async () => {
    const workspace2 = {
      ...mockWorkspace,
      id: "biz-2",
      contentStrategy: {
        ...mockWorkspace.contentStrategy,
        id: "cs-2",
        businessId: "biz-2",
      },
    };
    prismaMock.business.findMany.mockResolvedValue([mockWorkspace, workspace2] as any);

    // First workspace: fetch fails, second: fetch succeeds
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(mockFetchXml(rss20Xml([
        { title: "Article", link: "https://example.com/a", description: "text" },
      ])));

    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "synthesize_themes", input: validSynthesis }],
    });
    prismaMock.researchSummary.create.mockResolvedValue({ id: "rs-1" } as any);

    const result = await runResearchPipeline(Date.now() + 120_000);

    // First workspace had no items (RSS error), second processed successfully
    expect(result).toEqual({ processed: 1 });
  });

  it("fetches Reddit posts when subreddits are configured", async () => {
    const workspaceWithReddit = {
      ...mockWorkspace,
      contentStrategy: {
        ...mockWorkspace.contentStrategy,
        researchSources: { subreddits: ["marketing"] },
      },
    };
    prismaMock.business.findMany.mockResolvedValue([workspaceWithReddit] as any);

    // Mock fetch for Reddit (no OAuth creds in test env, so uses public endpoint)
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          children: [
            {
              data: {
                title: "Reddit Post",
                permalink: "/r/marketing/comments/abc",
                selftext: "Great discussion",
                score: 42,
                created_utc: 1709337600,
              },
            },
          ],
        },
      }),
    });

    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "synthesize_themes", input: validSynthesis }],
    });
    prismaMock.researchSummary.create.mockResolvedValue({ id: "rs-1" } as any);

    const result = await runResearchPipeline(Date.now() + 60_000);

    expect(result).toEqual({ processed: 1 });
    expect(prismaMock.researchSummary.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourcesUsed: expect.arrayContaining(["reddit"]),
      }),
    });
  });

  it("handles Reddit rate limiting gracefully", async () => {
    const workspaceWithReddit = {
      ...mockWorkspace,
      contentStrategy: {
        ...mockWorkspace.contentStrategy,
        researchSources: { subreddits: ["marketing"] },
      },
    };
    prismaMock.business.findMany.mockResolvedValue([workspaceWithReddit] as any);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
    });

    const result = await runResearchPipeline(Date.now() + 60_000);

    expect(result).toEqual({ processed: 0 });
  });

  it("calls reportServerError when research pipeline fails for a workspace", async () => {
    prismaMock.business.findMany.mockResolvedValue([mockWorkspace] as any);

    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchXml(rss20Xml([
      { title: "Article 1", link: "https://example.com/1", description: "Snippet 1" },
    ])));

    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "synthesize_themes", input: validSynthesis }],
    });

    // DB create fails
    prismaMock.researchSummary.create.mockRejectedValue(new Error("DB write failed"));

    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    await runResearchPipeline(Date.now() + 60_000);
    consoleSpy.mockRestore();

    expect(mockReportServerError).toHaveBeenCalledWith(
      expect.stringContaining("biz-1"),
      expect.objectContaining({
        url: "cron/research",
        metadata: expect.objectContaining({
          workspaceId: "biz-1",
          source: "research-pipeline",
        }),
      })
    );
  });

  it("sanitizes HTML from RSS content", async () => {
    prismaMock.business.findMany.mockResolvedValue([mockWorkspace] as any);

    // Use CDATA to embed HTML in XML, as real RSS feeds do
    const xmlWithHtml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>
      <item>
        <title><![CDATA[<script>alert('xss')</script>Clean Title]]></title>
        <link>https://example.com/1</link>
        <description><![CDATA[<b>Bold</b> text with <a href='#'>link</a>]]></description>
      </item>
    </channel></rss>`;
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockFetchXml(xmlWithHtml));

    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "synthesize_themes", input: validSynthesis }],
    });
    prismaMock.researchSummary.create.mockResolvedValue({ id: "rs-1" } as any);

    await runResearchPipeline(Date.now() + 60_000);

    // Verify the items stored don't contain HTML
    const createCall = prismaMock.researchSummary.create.mock.calls[0][0];
    const sourceItems = createCall.data.sourceItems as any[];
    expect(sourceItems[0].title).not.toContain("<script>");
    expect(sourceItems[0].title).toContain("Clean Title");
    expect(sourceItems[0].snippet).not.toContain("<b>");
    expect(sourceItems[0].snippet).not.toContain("<a");
  });
});
