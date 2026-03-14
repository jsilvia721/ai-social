import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: jest.fn(),
}));

import { trackApiCall, trackCronRun } from "@/lib/system-metrics";
import { shouldMockExternalApis } from "@/lib/mocks/config";

const mockShouldMock = shouldMockExternalApis as jest.MockedFunction<
  typeof shouldMockExternalApis
>;

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
  mockShouldMock.mockReturnValue(false);
});

describe("trackApiCall", () => {
  it("writes to DB with correct fields", async () => {
    prismaMock.apiCall.create.mockResolvedValue({ id: "ac-1" } as any);

    await trackApiCall({
      service: "blotato",
      endpoint: "publishPost",
      method: "POST",
      statusCode: 200,
      latencyMs: 150,
      metadata: { postId: "post-1" },
    });

    expect(prismaMock.apiCall.create).toHaveBeenCalledWith({
      data: {
        service: "blotato",
        endpoint: "publishPost",
        method: "POST",
        statusCode: 200,
        latencyMs: 150,
        error: undefined,
        metadata: { postId: "post-1" },
      },
    });
  });

  it("defaults method to POST when not provided", async () => {
    prismaMock.apiCall.create.mockResolvedValue({ id: "ac-2" } as any);

    await trackApiCall({
      service: "anthropic",
      endpoint: "messages",
      latencyMs: 500,
    });

    expect(prismaMock.apiCall.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        method: "POST",
      }),
    });
  });

  it("skips write when shouldMockExternalApis returns true", async () => {
    mockShouldMock.mockReturnValue(true);

    await trackApiCall({
      service: "blotato",
      endpoint: "publishPost",
      latencyMs: 100,
    });

    expect(prismaMock.apiCall.create).not.toHaveBeenCalled();
  });

  it("swallows DB errors without throwing", async () => {
    prismaMock.apiCall.create.mockRejectedValue(
      new Error("DB connection lost")
    );

    await expect(
      trackApiCall({
        service: "blotato",
        endpoint: "publishPost",
        latencyMs: 100,
      })
    ).resolves.toBeUndefined();
  });
});

describe("trackCronRun", () => {
  const now = new Date();

  it("writes to DB with correct fields", async () => {
    prismaMock.cronRun.create.mockResolvedValue({ id: "cr-1" } as any);

    await trackCronRun({
      cronName: "publish",
      status: "SUCCESS",
      itemsProcessed: 5,
      durationMs: 3000,
      startedAt: now,
      completedAt: now,
      metadata: { batchId: "b-1" },
    });

    expect(prismaMock.cronRun.create).toHaveBeenCalledWith({
      data: {
        cronName: "publish",
        status: "SUCCESS",
        itemsProcessed: 5,
        durationMs: 3000,
        error: undefined,
        metadata: { batchId: "b-1" },
        startedAt: now,
        completedAt: now,
      },
    });
  });

  it("writes even when shouldMockExternalApis returns true", async () => {
    mockShouldMock.mockReturnValue(true);
    prismaMock.cronRun.create.mockResolvedValue({ id: "cr-2" } as any);

    await trackCronRun({
      cronName: "metrics",
      status: "RUNNING",
      startedAt: now,
    });

    expect(prismaMock.cronRun.create).toHaveBeenCalled();
  });

  it("swallows DB errors without throwing", async () => {
    prismaMock.cronRun.create.mockRejectedValue(
      new Error("DB connection lost")
    );

    await expect(
      trackCronRun({
        cronName: "publish",
        status: "FAILED",
        error: "timeout",
        startedAt: now,
      })
    ).resolves.toBeUndefined();
  });
});
