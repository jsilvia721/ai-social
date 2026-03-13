import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { reportServerError } from "@/lib/server-error-reporter";
import crypto from "crypto";
import { normalizeMessage } from "@/lib/normalize-error";

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("reportServerError", () => {
  it("creates a new ErrorReport with source SERVER", async () => {
    const mockReport = {
      id: "err-1",
      fingerprint: "abc123",
      count: 1,
      message: "Something broke",
      source: "SERVER",
      stack: null,
      url: null,
      metadata: null,
      status: "NEW",
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
      githubIssueNumber: null,
      acknowledgedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prismaMock.errorReport.upsert.mockResolvedValue(mockReport as any);

    await reportServerError("Something broke");

    const expectedFingerprint = crypto
      .createHash("sha256")
      .update("SERVER:" + normalizeMessage("Something broke"))
      .digest("hex");

    expect(prismaMock.errorReport.upsert).toHaveBeenCalledWith({
      where: { fingerprint: expectedFingerprint },
      create: {
        fingerprint: expectedFingerprint,
        message: "Something broke",
        stack: undefined,
        source: "SERVER",
        url: undefined,
        metadata: undefined,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: expect.any(Date),
        stack: undefined,
      },
    });
  });

  it("passes optional stack, url, and metadata through to the upsert", async () => {
    prismaMock.errorReport.upsert.mockResolvedValue({ count: 1 } as any);

    await reportServerError("Publish failed", {
      stack: "Error: Publish failed\n  at foo.ts:10",
      url: "cron/publish",
      metadata: { postId: "post-1", platform: "TWITTER" },
    });

    expect(prismaMock.errorReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          stack: "Error: Publish failed\n  at foo.ts:10",
          url: "cron/publish",
          metadata: { postId: "post-1", platform: "TWITTER" },
        }),
        update: expect.objectContaining({
          stack: "Error: Publish failed\n  at foo.ts:10",
        }),
      })
    );
  });

  it("deduplicates errors by incrementing count on upsert collision", async () => {
    // Simulate the same error being reported twice
    prismaMock.errorReport.upsert.mockResolvedValue({ count: 2 } as any);

    await reportServerError("Duplicate error");

    // The upsert update clause includes count increment
    expect(prismaMock.errorReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          count: { increment: 1 },
          lastSeenAt: expect.any(Date),
        }),
      })
    );
  });

  it("normalizes messages for fingerprinting (dynamic values replaced)", async () => {
    prismaMock.errorReport.upsert.mockResolvedValue({ count: 1 } as any);

    await reportServerError("Post post-123 failed at 2024-01-15T14:30:00.000Z");

    // The fingerprint should use normalized message
    const expectedFingerprint = crypto
      .createHash("sha256")
      .update(
        "SERVER:" +
          normalizeMessage("Post post-123 failed at 2024-01-15T14:30:00.000Z")
      )
      .digest("hex");

    expect(prismaMock.errorReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fingerprint: expectedFingerprint },
        // But the raw message is stored
        create: expect.objectContaining({
          message: "Post post-123 failed at 2024-01-15T14:30:00.000Z",
        }),
      })
    );
  });

  it("never throws — swallows errors from prisma silently", async () => {
    prismaMock.errorReport.upsert.mockRejectedValue(
      new Error("DB connection lost")
    );

    // Should NOT throw
    await expect(
      reportServerError("Something broke")
    ).resolves.toBeUndefined();
  });

  it("never throws — swallows unexpected runtime errors", async () => {
    // Force a weird scenario
    prismaMock.errorReport.upsert.mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined");
    });

    await expect(
      reportServerError("Something broke")
    ).resolves.toBeUndefined();
  });
});
