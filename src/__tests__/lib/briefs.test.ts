// Mock Anthropic SDK
jest.mock("@anthropic-ai/sdk", () => {
  const mockCreate = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    _mockCreate: mockCreate,
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { _mockCreate: anthropicCreate } = require("@anthropic-ai/sdk");

// Mock SES
jest.mock("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  SendEmailCommand: jest.fn(),
}));

// Mock error reporter
const mockReportServerError = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/server-error-reporter", () => ({
  reportServerError: (...args: unknown[]) => mockReportServerError(...args),
}));

import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
jest.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { runBriefGeneration } from "@/lib/briefs";

beforeEach(() => {
  resetPrismaMock();
  anthropicCreate.mockReset();
  mockReportServerError.mockReset().mockResolvedValue(undefined);
  jest.clearAllMocks();
});

const mockWorkspace = {
  id: "biz-1",
  name: "Test Biz",
  contentStrategy: {
    id: "cs-1",
    businessId: "biz-1",
    industry: "Marketing",
    targetAudience: "SMBs",
    contentPillars: ["AI", "Growth"],
    brandVoice: "Professional yet friendly",
    postingCadence: { TWITTER: 2, INSTAGRAM: 1 },
    researchSources: null,
  },
  socialAccounts: [
    { platform: "TWITTER" },
    { platform: "INSTAGRAM" },
  ],
  members: [
    { role: "OWNER", user: { email: "owner@example.com" } },
  ],
};

const validBriefResult = {
  briefs: [
    {
      topic: "AI Marketing Trends",
      rationale: "AI is transforming marketing strategies.",
      suggestedCaption: "The future of marketing is here! #AI #Marketing",
      aiImagePrompt: "A futuristic marketing dashboard with AI graphs",
      recommendedFormat: "IMAGE",
      platform: "TWITTER",
      suggestedDay: "MONDAY 10:00",
    },
    {
      topic: "Growth Hacking Tips",
      rationale: "Growth hacking remains relevant for SMBs.",
      suggestedCaption: "5 growth hacks every small business needs 🚀",
      contentGuidance: "Photo of team brainstorming at whiteboard",
      recommendedFormat: "IMAGE",
      platform: "INSTAGRAM",
      suggestedDay: "WEDNESDAY 14:00",
    },
  ],
};

describe("runBriefGeneration", () => {
  it("returns { processed: 0, briefsCreated: 0 } when no workspaces", async () => {
    prismaMock.business.findMany.mockResolvedValue([]);

    const result = await runBriefGeneration(Date.now() + 60_000);

    expect(result).toEqual({ processed: 0, briefsCreated: 0 });
  });

  it("expires old PENDING briefs before generating new ones", async () => {
    prismaMock.business.findMany.mockResolvedValue([mockWorkspace] as any);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.researchSummary.findFirst.mockResolvedValue(null);
    prismaMock.post.findMany.mockResolvedValue([]);

    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "generate_content_briefs", input: validBriefResult }],
    });
    prismaMock.contentBrief.create.mockResolvedValue({ id: "cb-1" } as any);

    await runBriefGeneration(Date.now() + 60_000);

    expect(prismaMock.contentBrief.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        businessId: "biz-1",
        status: "PENDING",
        weekOf: expect.objectContaining({ lt: expect.any(Date) }),
      }),
      data: { status: "EXPIRED" },
    });
  });

  it("creates briefs from Claude output and returns counts", async () => {
    prismaMock.business.findMany.mockResolvedValue([mockWorkspace] as any);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.researchSummary.findFirst.mockResolvedValue({
      id: "rs-1",
      synthesizedThemes: "AI is trending",
    } as any);
    prismaMock.post.findMany.mockResolvedValue([]);

    anthropicCreate.mockResolvedValue({
      content: [{ type: "tool_use", name: "generate_content_briefs", input: validBriefResult }],
    });
    prismaMock.contentBrief.create
      .mockResolvedValueOnce({ id: "cb-1", topic: "AI Marketing Trends", platform: "TWITTER", recommendedFormat: "IMAGE", suggestedCaption: "test", scheduledFor: new Date() } as any)
      .mockResolvedValueOnce({ id: "cb-2", topic: "Growth Hacking Tips", platform: "INSTAGRAM", recommendedFormat: "IMAGE", suggestedCaption: "test", scheduledFor: new Date() } as any);

    const result = await runBriefGeneration(Date.now() + 60_000);

    expect(result).toEqual({ processed: 1, briefsCreated: 2 });
    expect(prismaMock.contentBrief.create).toHaveBeenCalledTimes(2);
  });

  it("includes research summary ID when available", async () => {
    prismaMock.business.findMany.mockResolvedValue([mockWorkspace] as any);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.researchSummary.findFirst.mockResolvedValue({
      id: "rs-latest",
      synthesizedThemes: "Themes here",
    } as any);
    prismaMock.post.findMany.mockResolvedValue([]);

    anthropicCreate.mockResolvedValue({
      content: [{
        type: "tool_use",
        name: "generate_content_briefs",
        input: { briefs: [validBriefResult.briefs[0]] },
      }],
    });
    prismaMock.contentBrief.create.mockResolvedValue({ id: "cb-1", topic: "test", platform: "TWITTER", recommendedFormat: "TEXT", suggestedCaption: "test", scheduledFor: new Date() } as any);

    await runBriefGeneration(Date.now() + 60_000);

    expect(prismaMock.contentBrief.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        researchSummaryId: "rs-latest",
      }),
    });
  });

  it("bails early when deadline approaches", async () => {
    prismaMock.business.findMany.mockResolvedValue([mockWorkspace, mockWorkspace] as any);

    const result = await runBriefGeneration(Date.now() - 1000);

    expect(result).toEqual({ processed: 0, briefsCreated: 0 });
  });

  it("continues to next workspace when one fails", async () => {
    const workspace2 = { ...mockWorkspace, id: "biz-2" };
    prismaMock.business.findMany.mockResolvedValue([mockWorkspace, workspace2] as any);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.researchSummary.findFirst.mockResolvedValue(null);
    prismaMock.post.findMany.mockResolvedValue([]);

    // First workspace fails, second succeeds
    anthropicCreate
      .mockRejectedValueOnce(new Error("Claude error"))
      .mockResolvedValueOnce({
        content: [{
          type: "tool_use",
          name: "generate_content_briefs",
          input: { briefs: [validBriefResult.briefs[0]] },
        }],
      });
    prismaMock.contentBrief.create.mockResolvedValue({ id: "cb-1", topic: "test", platform: "TWITTER", recommendedFormat: "TEXT", suggestedCaption: "test", scheduledFor: new Date() } as any);

    const result = await runBriefGeneration(Date.now() + 120_000);

    expect(result).toEqual({ processed: 1, briefsCreated: 1 });
  });

  it("calls reportServerError when brief generation fails for a workspace", async () => {
    prismaMock.business.findMany.mockResolvedValue([mockWorkspace] as any);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.researchSummary.findFirst.mockResolvedValue(null);
    prismaMock.post.findMany.mockResolvedValue([]);

    anthropicCreate.mockRejectedValue(new Error("Claude overloaded"));

    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    await runBriefGeneration(Date.now() + 60_000);
    consoleSpy.mockRestore();

    expect(mockReportServerError).toHaveBeenCalledWith(
      expect.stringContaining("biz-1"),
      expect.objectContaining({
        url: "cron/briefs",
        metadata: expect.objectContaining({
          workspaceId: "biz-1",
          source: "brief-generation",
        }),
      })
    );
  });

  it("uses default cadence when postingCadence is null", async () => {
    const workspaceNoCadence = {
      ...mockWorkspace,
      contentStrategy: {
        ...mockWorkspace.contentStrategy,
        postingCadence: null,
      },
    };
    prismaMock.business.findMany.mockResolvedValue([workspaceNoCadence] as any);
    prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.researchSummary.findFirst.mockResolvedValue(null);
    prismaMock.post.findMany.mockResolvedValue([]);

    anthropicCreate.mockResolvedValue({
      content: [{
        type: "tool_use",
        name: "generate_content_briefs",
        input: { briefs: [validBriefResult.briefs[0]] },
      }],
    });
    prismaMock.contentBrief.create.mockResolvedValue({ id: "cb-1", topic: "test", platform: "TWITTER", recommendedFormat: "TEXT", suggestedCaption: "test", scheduledFor: new Date() } as any);

    await runBriefGeneration(Date.now() + 60_000);

    // Should still call Claude — default cadence used
    expect(anthropicCreate).toHaveBeenCalled();
    const prompt = anthropicCreate.mock.calls[0][0].messages[0].content;
    // Default is 3 per platform, 2 platforms = 6 total
    expect(prompt).toContain("6 total");
  });
});
