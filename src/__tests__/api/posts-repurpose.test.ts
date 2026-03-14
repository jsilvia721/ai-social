import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));
jest.mock("@/lib/ai/repurpose");

import { POST } from "@/app/api/posts/repurpose/route";
import { repurposeContent } from "@/lib/ai/repurpose";
import { NextRequest } from "next/server";

const mockRepurpose = repurposeContent as jest.MockedFunction<typeof repurposeContent>;

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/posts/repurpose", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const validBody = {
  sourceContent: "Morning workouts can increase your productivity by 30%.",
};

const mockStrategy = {
  id: "cs-1",
  businessId: "biz-1",
  industry: "Fitness",
  targetAudience: "Busy professionals",
  contentPillars: ["Workout tips", "Nutrition"],
  brandVoice: "Energetic and motivating.",
};

const mockAccounts = [
  { id: "sa-1", businessId: "biz-1", platform: "TWITTER", username: "test" },
  { id: "sa-2", businessId: "biz-1", platform: "INSTAGRAM", username: "test_ig" },
];

const mockRepurposeResult = {
  coreMessage: "Morning workouts boost productivity by 30%",
  variants: [
    { platform: "TWITTER" as const, content: "Morning workouts = 30% more productive. #fitness", topicPillar: "Workout tips", tone: "educational" },
    { platform: "INSTAGRAM" as const, content: "Rise and grind! 🌅 #morningworkout #fitness", topicPillar: "Workout tips", tone: "educational" },
  ],
};

describe("POST /api/posts/repurpose", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
  });

  it("returns 400 for empty sourceContent", async () => {
    mockAuthenticated();
    const res = await POST(makeRequest({ sourceContent: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing sourceContent", async () => {
    mockAuthenticated();
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 403 when user is not a member of the business", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(403);
  });

  it("returns 400 when no social accounts connected", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.socialAccount.findMany.mockResolvedValue([]);
    prismaMock.contentStrategy.findUnique.mockResolvedValue(mockStrategy as any);

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("account");
  });

  it("returns 400 when no content strategy exists", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.socialAccount.findMany.mockResolvedValue(mockAccounts as any);
    prismaMock.contentStrategy.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("onboarding");
  });

  it("returns 201 with repurposeGroupId and posts on success", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.socialAccount.findMany.mockResolvedValue(mockAccounts as any);
    prismaMock.contentStrategy.findUnique.mockResolvedValue(mockStrategy as any);
    mockRepurpose.mockResolvedValue(mockRepurposeResult);

    const createdPosts = [
      { id: "post-1", content: mockRepurposeResult.variants[0].content, status: "DRAFT" },
      { id: "post-2", content: mockRepurposeResult.variants[1].content, status: "DRAFT" },
    ];
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      // Simulate interactive transaction by calling fn with prismaMock
      if (typeof fn === "function") {
        return fn(prismaMock);
      }
      return createdPosts;
    });
    prismaMock.post.create.mockResolvedValueOnce(createdPosts[0] as any);
    prismaMock.post.create.mockResolvedValueOnce(createdPosts[1] as any);

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.repurposeGroupId).toBeDefined();
    expect(body.posts).toHaveLength(2);
  });

  it("calls repurposeContent with correct strategy and platforms", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.socialAccount.findMany.mockResolvedValue(mockAccounts as any);
    prismaMock.contentStrategy.findUnique.mockResolvedValue(mockStrategy as any);
    mockRepurpose.mockResolvedValue(mockRepurposeResult);
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as any);

    await POST(makeRequest(validBody));

    expect(mockRepurpose).toHaveBeenCalledTimes(1);
    const call = mockRepurpose.mock.calls[0][0];
    expect(call.sourceContent).toBe(validBody.sourceContent);
    expect(call.targetPlatforms).toEqual(expect.arrayContaining(["TWITTER", "INSTAGRAM"]));
    expect(call.strategy.industry).toBe("Fitness");
  });

  it("filters targetPlatforms to only connected platforms", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    // Only Twitter connected
    prismaMock.socialAccount.findMany.mockResolvedValue([mockAccounts[0]] as any);
    prismaMock.contentStrategy.findUnique.mockResolvedValue(mockStrategy as any);

    const singleVariantResult = {
      coreMessage: "test",
      variants: [mockRepurposeResult.variants[0]],
    };
    mockRepurpose.mockResolvedValue(singleVariantResult);
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as any);

    // Request all platforms but only Twitter connected
    await POST(makeRequest({
      ...validBody,
      targetPlatforms: ["TWITTER", "INSTAGRAM", "FACEBOOK"],
    }));

    const call = mockRepurpose.mock.calls[0][0];
    expect(call.targetPlatforms).toEqual(["TWITTER"]);
  });

  it("defaults all variants to DRAFT status", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.socialAccount.findMany.mockResolvedValue(mockAccounts as any);
    prismaMock.contentStrategy.findUnique.mockResolvedValue(mockStrategy as any);
    mockRepurpose.mockResolvedValue(mockRepurposeResult);
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as any);

    await POST(makeRequest(validBody));

    // Check that post.create was called with DRAFT status
    const createCalls = prismaMock.post.create.mock.calls;
    for (const call of createCalls) {
      expect(call[0].data.status).toBe("DRAFT");
    }
  });

  it("skips media-required platforms when status is SCHEDULED", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.socialAccount.findMany.mockResolvedValue(mockAccounts as any);
    prismaMock.contentStrategy.findUnique.mockResolvedValue(mockStrategy as any);
    mockRepurpose.mockResolvedValue(mockRepurposeResult);
    prismaMock.$transaction.mockImplementation(async (fn: any) => {
      if (typeof fn === "function") return fn(prismaMock);
      return [];
    });
    prismaMock.post.create.mockResolvedValue({ id: "post-1" } as any);

    const res = await POST(makeRequest({
      ...validBody,
      status: "SCHEDULED",
      scheduledAt: "2027-06-01T12:00:00Z",
    }));

    expect(res.status).toBe(201);
    // Only Twitter post should be created (Instagram skipped due to media requirement)
    const createCalls = prismaMock.post.create.mock.calls;
    const platforms = createCalls.map(call => {
      const account = mockAccounts.find(a => a.id === call[0].data.socialAccountId);
      return account?.platform;
    });
    expect(platforms).not.toContain("INSTAGRAM");
    expect(platforms).toContain("TWITTER");
  });

  it("returns 500 when repurposeContent throws", async () => {
    mockAuthenticated();
    prismaMock.businessMember.findUnique.mockResolvedValue({ id: "bm-1" } as any);
    prismaMock.socialAccount.findMany.mockResolvedValue(mockAccounts as any);
    prismaMock.contentStrategy.findUnique.mockResolvedValue(mockStrategy as any);
    mockRepurpose.mockRejectedValue(new Error("Claude API timeout"));

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
  });
});
