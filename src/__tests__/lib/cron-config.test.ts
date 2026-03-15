import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { checkCronEnabled } from "@/lib/system-metrics";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("checkCronEnabled", () => {
  it("returns enabled: true when cron is enabled", async () => {
    prismaMock.cronConfig.findUnique.mockResolvedValue({
      id: "cc-1",
      cronName: "publish",
      scheduleExpression: "rate(1 minute)",
      scheduleType: "rate",
      enabled: true,
      intervalValue: 1,
      intervalUnit: "minutes",
      dayOfWeek: null,
      hourUtc: null,
      syncStatus: "SYNCED",
      updatedAt: new Date(),
    });

    const result = await checkCronEnabled("publish");
    expect(result).toEqual({ enabled: true });
    expect(prismaMock.cronConfig.findUnique).toHaveBeenCalledWith({
      where: { cronName: "publish" },
      select: { enabled: true },
    });
  });

  it("returns enabled: false when cron is disabled", async () => {
    prismaMock.cronConfig.findUnique.mockResolvedValue({
      id: "cc-2",
      cronName: "metrics",
      scheduleExpression: "rate(60 minutes)",
      scheduleType: "rate",
      enabled: false,
      intervalValue: 60,
      intervalUnit: "minutes",
      dayOfWeek: null,
      hourUtc: null,
      syncStatus: "SYNCED",
      updatedAt: new Date(),
    });

    const result = await checkCronEnabled("metrics");
    expect(result).toEqual({ enabled: false });
  });

  it("returns enabled: true when cron config not found (fail open)", async () => {
    prismaMock.cronConfig.findUnique.mockResolvedValue(null);

    const result = await checkCronEnabled("publish");
    expect(result).toEqual({ enabled: true });
  });

  it("returns enabled: true on DB error (fail open) and logs warning", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation();
    prismaMock.cronConfig.findUnique.mockRejectedValue(
      new Error("DB connection lost")
    );

    const result = await checkCronEnabled("publish");
    expect(result).toEqual({ enabled: true });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[checkCronEnabled]"),
      expect.any(Error)
    );
    warnSpy.mockRestore();
  });
});
