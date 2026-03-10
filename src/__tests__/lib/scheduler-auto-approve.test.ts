import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/blotato/publish");
jest.mock("@aws-sdk/client-ses");

import { runScheduler } from "@/lib/scheduler";
import { publishPost } from "@/lib/blotato/publish";

const mockPublishPost = publishPost as jest.MockedFunction<typeof publishPost>;

beforeEach(() => {
  resetPrismaMock();
  // Default: no stuck posts, no due posts
  prismaMock.post.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.post.findMany.mockResolvedValue([]);
  mockPublishPost.mockResolvedValue({ blotatoPostId: "bp-1" });
});

describe("autoApproveExpiredReviews", () => {
  it("auto-approves posts with expired reviewWindowExpiresAt", async () => {
    await runScheduler();

    // Should call updateMany for auto-approval (separate from stuck recovery)
    const updateManyCalls = prismaMock.post.updateMany.mock.calls;
    const autoApproveCall = updateManyCalls.find(
      ([args]) =>
        args?.where?.status === "PENDING_REVIEW" &&
        args?.data?.status === "SCHEDULED"
    );
    expect(autoApproveCall).toBeDefined();
    expect(autoApproveCall![0].where).toEqual(
      expect.objectContaining({
        status: "PENDING_REVIEW",
        reviewWindowExpiresAt: expect.objectContaining({
          lte: expect.any(Date),
          not: null,
        }),
      })
    );
  });

  it("does NOT auto-approve posts with null reviewWindowExpiresAt", async () => {
    await runScheduler();

    const updateManyCalls = prismaMock.post.updateMany.mock.calls;
    const autoApproveCall = updateManyCalls.find(
      ([args]) =>
        args?.where?.status === "PENDING_REVIEW" &&
        args?.data?.status === "SCHEDULED"
    );
    // The query should explicitly exclude null reviewWindowExpiresAt
    expect(autoApproveCall).toBeDefined();
    const where = autoApproveCall![0].where as Record<string, unknown>; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    expect(where.reviewWindowExpiresAt).toEqual(
      expect.objectContaining({ not: null })
    );
  });

  it("does not prevent publisher from running when auto-approval throws", async () => {
    // Make auto-approval throw
    prismaMock.post.updateMany
      .mockRejectedValueOnce(new Error("DB connection lost")) // stuck recovery
      .mockRejectedValueOnce(new Error("DB connection lost")); // auto-approve
    // Re-mock for stuck recovery to succeed
    prismaMock.post.updateMany
      .mockReset()
      .mockResolvedValueOnce({ count: 0 }) // stuck recovery
      .mockRejectedValueOnce(new Error("Auto-approve DB error")) // auto-approve throws
      .mockResolvedValueOnce({ count: 0 }); // any subsequent calls

    // Publisher should still run (not throw)
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();
    await expect(runScheduler()).resolves.not.toThrow();
    consoleSpy.mockRestore();
  });
});
