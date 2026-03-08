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

  it("returns existing ContentStrategy without calling Claude (idempotent)", async () => {
    (prismaMock.businessMember.findFirst as jest.Mock).mockResolvedValue({
      userId: "user-test-id",
      businessId: BUSINESS_ID,
      role: "OWNER",
    });
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
    (prismaMock.businessMember.findFirst as jest.Mock).mockResolvedValue({
      userId: "user-test-id",
      businessId: BUSINESS_ID,
      role: "OWNER",
    });
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);
    mockExtract.mockResolvedValue(STRATEGY_DATA);
    (prismaMock.contentStrategy.create as jest.Mock).mockResolvedValue({
      id: "cs-2",
      businessId: BUSINESS_ID,
      ...STRATEGY_DATA,
    });

    const answers = { businessType: "Gym", targetAudience: "Professionals" };
    const res = await POST(makeReq({ answers }), mockParams);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(mockExtract).toHaveBeenCalledWith(answers);
    expect(prismaMock.contentStrategy.create).toHaveBeenCalledWith({
      data: { businessId: BUSINESS_ID, ...STRATEGY_DATA },
    });
    expect(body.strategy.id).toBe("cs-2");
  });

  it("returns 400 when answers missing and no existing strategy", async () => {
    (prismaMock.businessMember.findFirst as jest.Mock).mockResolvedValue({
      userId: "user-test-id",
      businessId: BUSINESS_ID,
      role: "OWNER",
    });
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await POST(makeReq({}), mockParams);

    expect(res.status).toBe(400);
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it("returns 500 when Claude extraction fails", async () => {
    (prismaMock.businessMember.findFirst as jest.Mock).mockResolvedValue({
      userId: "user-test-id",
      businessId: BUSINESS_ID,
      role: "OWNER",
    });
    (prismaMock.contentStrategy.findUnique as jest.Mock).mockResolvedValue(null);
    mockExtract.mockRejectedValue(new Error("Claude did not call save_content_strategy"));

    const res = await POST(
      makeReq({ answers: { businessType: "Gym" } }),
      mockParams
    );

    expect(res.status).toBe(500);
  });
});
