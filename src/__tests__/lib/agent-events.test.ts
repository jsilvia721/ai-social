import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: jest.fn(),
}));

import { emitAgentEvent } from "@/lib/agent-events";
import { shouldMockExternalApis } from "@/lib/mocks/config";

const mockShouldMock = shouldMockExternalApis as jest.MockedFunction<
  typeof shouldMockExternalApis
>;

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
  mockShouldMock.mockReturnValue(false);
});

describe("emitAgentEvent", () => {
  it("writes to DB with all fields", async () => {
    prismaMock.agentEvent.create.mockResolvedValue({ id: "ae-1" } as any);

    await emitAgentEvent({
      eventType: "brief.generated",
      actor: "cron:briefs",
      businessId: "biz-1",
      entityType: "ContentBrief",
      entityId: "cb-1",
      payload: { platform: "TWITTER", topic: "AI trends" },
    });

    expect(prismaMock.agentEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: "brief.generated",
        actor: "cron:briefs",
        businessId: "biz-1",
        entityType: "ContentBrief",
        entityId: "cb-1",
        payload: { platform: "TWITTER", topic: "AI trends" },
      },
    });
  });

  it("writes with only required fields", async () => {
    prismaMock.agentEvent.create.mockResolvedValue({ id: "ae-2" } as any);

    await emitAgentEvent({
      eventType: "research.sources_fetched",
      actor: "cron:research",
    });

    expect(prismaMock.agentEvent.create).toHaveBeenCalledWith({
      data: {
        eventType: "research.sources_fetched",
        actor: "cron:research",
        businessId: undefined,
        entityType: undefined,
        entityId: undefined,
        payload: undefined,
      },
    });
  });

  it("skips write when shouldMockExternalApis returns true", async () => {
    mockShouldMock.mockReturnValue(true);

    await emitAgentEvent({
      eventType: "post.approved",
      actor: "user:u-1",
    });

    expect(prismaMock.agentEvent.create).not.toHaveBeenCalled();
  });

  it("swallows DB errors without throwing", async () => {
    prismaMock.agentEvent.create.mockRejectedValue(
      new Error("DB connection lost")
    );

    await expect(
      emitAgentEvent({
        eventType: "fulfillment.post_created",
        actor: "cron:fulfill",
        businessId: "biz-1",
      })
    ).resolves.toBeUndefined();
  });
});
