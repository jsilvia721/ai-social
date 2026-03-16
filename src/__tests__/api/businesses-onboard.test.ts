import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

// Mock the AI module so we don't call Anthropic in API tests
jest.mock("@/lib/ai", () => ({
  extractContentStrategy: jest.fn(),
  generatePostContent: jest.fn(),
  suggestOptimalTimes: jest.fn(),
}));

import { extractContentStrategy } from "@/lib/ai";
const mockExtract = extractContentStrategy as jest.Mock;

import { NextRequest } from "next/server";
import { POST } from "@/app/api/businesses/[id]/onboard/route";

const BUSINESS_ID = "biz-1";

function makeReq(body: Record<string, unknown> = {}) {
  return new NextRequest(`http://localhost/api/businesses/${BUSINESS_ID}/onboard`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const mockParams = { params: Promise.resolve({ id: BUSINESS_ID }) };

const STRATEGY_DATA = {
  industry: "Fitness",
  targetAudience: "Busy professionals",
  contentPillars: ["Workouts", "Nutrition"],
  brandVoice: "Energetic and science-backed",
  optimizationGoal: "ENGAGEMENT",
  reviewWindowEnabled: false,
  reviewWindowHours: 24,
};

const VALID_ANSWERS = {
  businessType: "Boutique HIIT fitness studio",
  targetAudience: "Busy professionals aged 30-45",
  tonePreference: "Energetic, science-backed",
  primaryGoal: "Grow membership through social",
};

function mockOwner() {
  (prismaMock.businessMember.findFirst as jest.Mock).mockResolvedValue({
    userId: "user-test-id",
    businessId: BUSINESS_ID,
    role: "OWNER",
  });
}

function mockMember() {
  (prismaMock.businessMember.findFirst as jest.Mock).mockResolvedValue({
    userId: "user-test-id",
    businessId: BUSINESS_ID,
    role: "MEMBER",
  });
}

describe("POST /api/businesses/[id]/onboard", () => {
  beforeEach(() => {
    resetPrismaMock();
    mockExtract.mockReset();
    mockAuthenticated();
  });

  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();

    const res = await POST(makeReq(), mockParams);

    expect(res.status).toBe(401);
  });

  it("returns 404 when user is not a member of the business", async () => {
    (prismaMock.businessMember.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeReq(), mockParams);

    expect(res.status).toBe(404);
  });

  it("returns 403 when user is a MEMBER (not OWNER)", async () => {
    mockMember();

    const res = await POST(makeReq({ answers: VALID_ANSWERS }), mockParams);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/owners/i);
  });

  it("returns existing ContentStrategy without calling Claude (idempotent)", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue({
      id: "cs-1",
      businessId: BUSINESS_ID,
      ...STRATEGY_DATA,
    });

    const res = await POST(makeReq(), mockParams);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.strategy.id).toBe("cs-1");
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("calls Claude and creates ContentStrategy when none exists", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);
    mockExtract.mockResolvedValue(STRATEGY_DATA);
    (prismaMock.contentStrategy.create as jest.Mock).mockResolvedValue({
      id: "cs-2",
      businessId: BUSINESS_ID,
      ...STRATEGY_DATA,
    });

    const res = await POST(makeReq({ answers: VALID_ANSWERS }), mockParams);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(mockExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        businessType: VALID_ANSWERS.businessType,
        competitors: "", // default
      })
    );
    expect(prismaMock.contentStrategy.create).toHaveBeenCalledWith({
      data: { businessId: BUSINESS_ID, ...STRATEGY_DATA },
    });
    expect(body.strategy.id).toBe("cs-2");
  });

  it("returns 400 when answers missing and no existing strategy", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeReq({}), mockParams);

    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("returns 400 when required fields are missing", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await POST(
      makeReq({ answers: { businessType: "Gym" } }), // missing targetAudience, tonePreference, primaryGoal
      mockParams
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details).toBeDefined();
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("returns 400 when field exceeds max length", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await POST(
      makeReq({
        answers: {
          ...VALID_ANSWERS,
          businessType: "x".repeat(501), // max is 500
        },
      }),
      mockParams
    );

    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("returns 400 when unknown keys are present (.strict())", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await POST(
      makeReq({
        answers: {
          ...VALID_ANSWERS,
          unknownField: "should not be here",
        },
      }),
      mockParams
    );

    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("accepts valid answers with optional competitors field", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);
    mockExtract.mockResolvedValue(STRATEGY_DATA);
    (prismaMock.contentStrategy.create as jest.Mock).mockResolvedValue({
      id: "cs-3",
      businessId: BUSINESS_ID,
      ...STRATEGY_DATA,
    });

    const answersWithCompetitors = {
      ...VALID_ANSWERS,
      competitors: "@CrossFitHQ for community energy",
    };

    const res = await POST(makeReq({ answers: answersWithCompetitors }), mockParams);

    expect(res.status).toBe(201);
    expect(mockExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        competitors: "@CrossFitHQ for community energy",
      })
    );
  });

  // ── New field tests ──────────────────────────────────────────────────────

  it("accepts valid payload with new optional fields (accountType, visualStyle, voiceSliders)", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);
    mockExtract.mockResolvedValue(STRATEGY_DATA);
    (prismaMock.contentStrategy.create as jest.Mock).mockResolvedValue({
      id: "cs-new",
      businessId: BUSINESS_ID,
      ...STRATEGY_DATA,
    });

    const answersWithNewFields = {
      ...VALID_ANSWERS,
      accountType: "INFLUENCER",
      visualStyle: "Minimalist aesthetic with earth tones",
      voiceSliders: { formality: 3, humor: 7, technicality: 2, boldness: 8 },
    };

    const res = await POST(makeReq({ answers: answersWithNewFields }), mockParams);

    expect(res.status).toBe(201);
    expect(mockExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        accountType: "INFLUENCER",
        visualStyle: "Minimalist aesthetic with earth tones",
        voiceSliders: { formality: 3, humor: 7, technicality: 2, boldness: 8 },
      })
    );
  });

  it("rejects invalid accountType value", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await POST(
      makeReq({
        answers: {
          ...VALID_ANSWERS,
          accountType: "INVALID_TYPE",
        },
      }),
      mockParams
    );

    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("rejects voiceSliders with out-of-range values", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await POST(
      makeReq({
        answers: {
          ...VALID_ANSWERS,
          voiceSliders: { formality: 0, humor: 11, technicality: 5, boldness: 5 },
        },
      }),
      mockParams
    );

    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("strips HTML tags from free-text fields", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);
    mockExtract.mockResolvedValue(STRATEGY_DATA);
    (prismaMock.contentStrategy.create as jest.Mock).mockResolvedValue({
      id: "cs-html",
      businessId: BUSINESS_ID,
      ...STRATEGY_DATA,
    });

    const answersWithHtml = {
      businessType: "<script>alert('xss')</script>Fitness studio",
      targetAudience: '<b>Busy</b> professionals <img src="x" onerror="alert(1)">',
      tonePreference: "Energetic<br>science-backed",
      primaryGoal: "<p>Grow membership</p>",
      visualStyle: "<div>Clean look</div>",
    };

    const res = await POST(makeReq({ answers: answersWithHtml }), mockParams);

    expect(res.status).toBe(201);
    expect(mockExtract).toHaveBeenCalledWith(
      expect.objectContaining({
        businessType: "alert('xss')Fitness studio",
        targetAudience: "Busy professionals ",
        tonePreference: "Energeticscience-backed",
        primaryGoal: "Grow membership",
        visualStyle: "Clean look",
      })
    );
  });

  it("returns 500 when Claude extraction fails", async () => {
    mockOwner();
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);
    mockExtract.mockRejectedValue(new Error("Claude did not call save_content_strategy"));

    const res = await POST(
      makeReq({ answers: VALID_ANSWERS }),
      mockParams
    );

    expect(res.status).toBe(500);
  });
});
