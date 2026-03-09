import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
import { mockAuthenticated, mockUnauthenticated, mockSession } from "@/__tests__/mocks/auth";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("next-auth/next");
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { GET } from "@/app/api/posts/review-count/route";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("GET /api/posts/review-count", () => {
  it("returns 401 when not authenticated", async () => {
    mockUnauthenticated();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns count 0 when no active business", async () => {
    mockAuthenticated({
      ...mockSession,
      // @ts-expect-error -- testing null activeBusinessId
      user: { ...mockSession.user, activeBusinessId: null },
    });
    const res = await GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.count).toBe(0);
  });

  it("returns review count for active business", async () => {
    mockAuthenticated();
    prismaMock.post.count.mockResolvedValue(5);
    const res = await GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.count).toBe(5);
    expect(prismaMock.post.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          businessId: "biz-1",
          status: "PENDING_REVIEW",
        }),
      })
    );
  });
});
