import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/media");
jest.mock("@/lib/server-error-reporter", () => ({
  reportServerError: jest.fn(),
}));

import { processCompletedPrediction, type BriefWithRelations } from "@/lib/video";
import { downloadAndUploadVideo } from "@/lib/media";
import { reportServerError } from "@/lib/server-error-reporter";

const mockDownload = downloadAndUploadVideo as jest.MockedFunction<typeof downloadAndUploadVideo>;
const mockReportError = reportServerError as jest.MockedFunction<typeof reportServerError>;

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeBrief(overrides?: Partial<BriefWithRelations>): BriefWithRelations {
  return {
    id: "brief-1",
    businessId: "biz-1",
    researchSummaryId: null,
    topic: "Test topic",
    rationale: "Test rationale",
    suggestedCaption: "Test caption #video",
    aiImagePrompt: null,
    contentGuidance: null,
    recommendedFormat: "VIDEO",
    platform: "TIKTOK",
    scheduledFor: new Date(Date.now() + 48 * 60 * 60_000),
    status: "FULFILLING",
    weekOf: new Date(),
    sortOrder: 0,
    retryCount: 0,
    errorMessage: null,
    videoScript: null,
    videoPrompt: "a cool video",
    storyboardImageUrl: "https://storage.example.com/storyboard.jpg",
    replicatePredictionId: "pred-123",
    videoModel: "minimax/video-01-live",
    videoAspectRatio: "9:16",
    postId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    business: {
      contentStrategy: {
        id: "strat-1",
        businessId: "biz-1",
        accountType: "creator",
        industry: "tech",
        targetAudience: "developers",
        contentPillars: ["tutorials", "tips"],
        toneKeywords: ["educational"],
        postingFrequency: 3,
        visualStyle: "modern",
        hashtagGroups: {},
        reviewWindowEnabled: true,
        reviewWindowHours: 24,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      socialAccounts: [
        {
          id: "account-1",
          businessId: "biz-1",
          platform: "TIKTOK",
          platformId: "tiktok-123",
          displayName: "Test Account",
          accessToken: "encrypted-token",
          refreshToken: "encrypted-refresh",
          tokenExpiresAt: new Date(Date.now() + 86400_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      ],
    },
    ...overrides,
  } as BriefWithRelations;
}

describe("processCompletedPrediction", () => {
  it("downloads video, uploads to S3, creates post, marks brief FULFILLED", async () => {
    const brief = makeBrief();
    const videoUrl = "https://storage.example.com/media/biz-1/brief-1.mp4";
    mockDownload.mockResolvedValue(videoUrl);

    const mockPost = { id: "post-1" };
    // $transaction executes the callback
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      return fn({
        post: { create: jest.fn().mockResolvedValue(mockPost) },
        contentBrief: { update: jest.fn().mockResolvedValue({}) },
      });
    });

    const result = await processCompletedPrediction(
      brief,
      "https://replicate.delivery/output/video.mp4"
    );

    expect(result.outcome).toBe("created");
    expect(result.postId).toBe("post-1");
    expect(mockDownload).toHaveBeenCalledWith(
      "https://replicate.delivery/output/video.mp4",
      "media/biz-1/brief-1.mp4"
    );
  });

  it("uses storyboardImageUrl as coverImageUrl", async () => {
    const brief = makeBrief({ storyboardImageUrl: "https://storage.example.com/storyboard.jpg" });
    mockDownload.mockResolvedValue("https://storage.example.com/media/biz-1/brief-1.mp4");

    let capturedPostData: any;
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      return fn({
        post: {
          create: jest.fn().mockImplementation((args: any) => {
            capturedPostData = args.data;
            return { id: "post-1" };
          }),
        },
        contentBrief: { update: jest.fn().mockResolvedValue({}) },
      });
    });

    await processCompletedPrediction(
      brief,
      "https://replicate.delivery/output/video.mp4"
    );

    expect(capturedPostData.coverImageUrl).toBe("https://storage.example.com/storyboard.jpg");
  });

  it("returns skipped when no content strategy", async () => {
    const brief = makeBrief({
      business: {
        contentStrategy: null,
        socialAccounts: [],
      },
    });

    const result = await processCompletedPrediction(
      brief,
      "https://replicate.delivery/output/video.mp4"
    );

    expect(result.outcome).toBe("skipped");
    expect(result.error).toContain("No content strategy");
  });

  it("returns skipped when no matching social account", async () => {
    const brief = makeBrief({
      business: {
        contentStrategy: makeBrief().business.contentStrategy,
        socialAccounts: [], // no accounts
      },
    });

    const result = await processCompletedPrediction(
      brief,
      "https://replicate.delivery/output/video.mp4"
    );

    expect(result.outcome).toBe("skipped");
    expect(result.error).toContain("No TIKTOK account");
  });

  it("returns failed and marks brief FAILED on download error", async () => {
    const brief = makeBrief();
    mockDownload.mockRejectedValue(new Error("Download failed: HTTP 500"));

    prismaMock.contentBrief.update.mockResolvedValue({} as any);

    const result = await processCompletedPrediction(
      brief,
      "https://replicate.delivery/output/video.mp4"
    );

    expect(result.outcome).toBe("failed");
    expect(result.error).toBe("Download failed: HTTP 500");
    expect(prismaMock.contentBrief.update).toHaveBeenCalledWith({
      where: { id: "brief-1" },
      data: { status: "FAILED", errorMessage: "Download failed: HTTP 500" },
    });
    expect(mockReportError).toHaveBeenCalledWith(
      "Video processing failed",
      expect.objectContaining({
        metadata: expect.objectContaining({ briefId: "brief-1", error: "Download failed: HTTP 500" }),
        stack: expect.any(String),
      })
    );
  });

  it("passes full error stack to reportServerError for stack traces", async () => {
    const brief = makeBrief();
    const originalError = new Error("S3 upload timeout");
    mockDownload.mockRejectedValue(originalError);

    prismaMock.contentBrief.update.mockResolvedValue({} as any);

    await processCompletedPrediction(
      brief,
      "https://replicate.delivery/output/video.mp4"
    );

    expect(mockReportError).toHaveBeenCalledWith(
      "Video processing failed",
      expect.objectContaining({
        stack: originalError.stack,
        metadata: expect.objectContaining({ error: "S3 upload timeout" }),
      })
    );
  });
});
