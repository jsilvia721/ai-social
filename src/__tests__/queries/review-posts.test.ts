import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { getReviewPosts } from "@/lib/queries/review-posts";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("getReviewPosts", () => {
  it("returns null when no activeBusinessId is set", async () => {
    const result = await getReviewPosts({
      user: { id: "user-1", activeBusinessId: null },
    });

    expect(result).toBeNull();
    expect(prismaMock.post.findMany).not.toHaveBeenCalled();
  });

  it("filters by socialAccount.businessId matching activeBusinessId", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    await getReviewPosts({
      user: { id: "user-1", activeBusinessId: "biz-1" },
    });

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          socialAccount: { businessId: "biz-1" },
        }),
      })
    );
  });

  it("filters by businessId and PENDING_REVIEW status", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    await getReviewPosts({
      user: { id: "user-1", activeBusinessId: "biz-1" },
    });

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: "biz-1",
          status: "PENDING_REVIEW",
        }),
      })
    );
  });

  it("includes membership filter for non-admin users", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    await getReviewPosts({
      user: { id: "user-1", activeBusinessId: "biz-1" },
    });

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          business: { members: { some: { userId: "user-1" } } },
        }),
      })
    );
  });

  it("admin bypasses membership filter", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    await getReviewPosts({
      user: { id: "user-1", isAdmin: true, activeBusinessId: "biz-1" },
    });

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({
          business: expect.anything(),
        }),
      })
    );
  });

  it("includes socialAccount and contentBrief in query", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    await getReviewPosts({
      user: { id: "user-1", activeBusinessId: "biz-1" },
    });

    expect(prismaMock.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          socialAccount: expect.any(Object),
          contentBrief: expect.any(Object),
        }),
      })
    );
  });
});
