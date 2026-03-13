import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { GET } from "@/app/api/test/audit-params/route";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("GET /api/test/audit-params", () => {
  describe("when PLAYWRIGHT_E2E is not set", () => {
    beforeEach(() => {
      delete process.env.PLAYWRIGHT_E2E;
    });

    afterEach(() => {
      process.env.PLAYWRIGHT_E2E = "true";
    });

    it("returns 404 when PLAYWRIGHT_E2E is absent", async () => {
      const res = await GET();
      expect(res.status).toBe(404);
      expect(prismaMock.business.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("when PLAYWRIGHT_E2E is set", () => {
    it("returns all params when data exists", async () => {
      prismaMock.business.findFirst.mockResolvedValue({
        id: "biz-1",
        name: "Test Biz",
        createdAt: new Date(),
        updatedAt: new Date(),
        description: null,
        industry: null,
        targetAudience: null,
        brandVoice: null,
        onboardingCompleted: false,
      } as never);

      prismaMock.post.findFirst
        .mockResolvedValueOnce({
          id: "post-1",
          repurposeGroupId: "rpg-1",
          createdAt: new Date(),
        } as never);

      const res = await GET();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({
        businessId: "biz-1",
        postId: "post-1",
        repurposeGroupId: "rpg-1",
      });
    });

    it("searches for a separate post with repurposeGroupId when first post lacks one", async () => {
      prismaMock.business.findFirst.mockResolvedValue({
        id: "biz-2",
        name: "Test Biz",
        createdAt: new Date(),
        updatedAt: new Date(),
        description: null,
        industry: null,
        targetAudience: null,
        brandVoice: null,
        onboardingCompleted: false,
      } as never);

      // First findFirst call: most recent post (no repurposeGroupId)
      prismaMock.post.findFirst
        .mockResolvedValueOnce({
          id: "post-2",
          repurposeGroupId: null,
          createdAt: new Date(),
        } as never)
        // Second findFirst call: post with repurposeGroupId
        .mockResolvedValueOnce({
          id: "post-3",
          repurposeGroupId: "rpg-2",
          createdAt: new Date(),
        } as never);

      const res = await GET();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({
        businessId: "biz-2",
        postId: "post-2",
        repurposeGroupId: "rpg-2",
      });

      // Should have made two post queries
      expect(prismaMock.post.findFirst).toHaveBeenCalledTimes(2);
    });

    it("returns all nulls when no data exists", async () => {
      prismaMock.business.findFirst.mockResolvedValue(null);
      prismaMock.post.findFirst.mockResolvedValue(null);

      const res = await GET();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toEqual({
        businessId: null,
        postId: null,
        repurposeGroupId: null,
      });
    });
  });
});
