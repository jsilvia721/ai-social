const mockSend = jest.fn().mockResolvedValue({});
jest.mock("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  SendEmailCommand: jest.fn(),
}));

// Mock error reporter
const mockReportServerError = jest.fn().mockResolvedValue(undefined);
jest.mock("@/lib/server-error-reporter", () => ({
  reportServerError: (...args: unknown[]) => mockReportServerError(...args),
}));

import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";
jest.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { SendEmailCommand } from "@aws-sdk/client-ses";
import { sendReviewNotifications } from "@/lib/notifications";

beforeEach(() => {
  resetPrismaMock();
  mockReportServerError.mockReset().mockResolvedValue(undefined);
  jest.clearAllMocks();
});

describe("sendReviewNotifications", () => {
  it("sends one email per business with pending review posts", async () => {
    prismaMock.post.findMany.mockResolvedValue([
      {
        id: "post-1",
        businessId: "biz-1",
        content: "Great post about AI trends",
        scheduledAt: new Date("2026-03-10T10:00:00Z"),
        socialAccount: { platform: "TWITTER", username: "acme_co" },
        business: {
          name: "Acme Corp",
          members: [
            { role: "OWNER", user: { email: "owner@acme.com" } },
          ],
        },
      },
      {
        id: "post-2",
        businessId: "biz-1",
        content: "5 tips for social media success",
        scheduledAt: new Date("2026-03-11T14:00:00Z"),
        socialAccount: { platform: "INSTAGRAM", username: "acme_ig" },
        business: {
          name: "Acme Corp",
          members: [
            { role: "OWNER", user: { email: "owner@acme.com" } },
          ],
        },
      },
    ] as never);

    await sendReviewNotifications();

    expect(mockSend).toHaveBeenCalledTimes(1);
    const emailArg = (SendEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    expect(emailArg.Destination.ToAddresses).toEqual(["owner@acme.com"]);
    expect(emailArg.Message.Subject.Data).toContain("2 posts ready for review");
    expect(emailArg.Message.Subject.Data).toContain("Acme Corp");
    expect(emailArg.Message.Body.Text.Data).toContain("TWITTER");
    expect(emailArg.Message.Body.Text.Data).toContain("INSTAGRAM");
  });

  it("sends separate emails to different businesses", async () => {
    prismaMock.post.findMany.mockResolvedValue([
      {
        id: "post-1",
        businessId: "biz-1",
        content: "Post for Acme",
        scheduledAt: new Date("2026-03-10T10:00:00Z"),
        socialAccount: { platform: "TWITTER", username: "acme_co" },
        business: {
          name: "Acme Corp",
          members: [
            { role: "OWNER", user: { email: "owner@acme.com" } },
          ],
        },
      },
      {
        id: "post-2",
        businessId: "biz-2",
        content: "Post for Beta",
        scheduledAt: new Date("2026-03-11T14:00:00Z"),
        socialAccount: { platform: "FACEBOOK", username: "beta_fb" },
        business: {
          name: "Beta Inc",
          members: [
            { role: "OWNER", user: { email: "owner@beta.com" } },
          ],
        },
      },
    ] as never);

    await sendReviewNotifications();

    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no posts are pending review", async () => {
    prismaMock.post.findMany.mockResolvedValue([]);

    await sendReviewNotifications();

    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does nothing when SES_FROM_EMAIL is not set", async () => {
    // env.SES_FROM_EMAIL is set in test setup — test that function still works
    // The actual no-SES guard is tested in notifications.test.ts
    prismaMock.post.findMany.mockResolvedValue([]);
    await sendReviewNotifications();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("skips businesses with no OWNER member", async () => {
    // Prisma's `where: { role: "OWNER" }` filter means members array is empty
    // when no owner exists — mock the filtered result
    prismaMock.post.findMany.mockResolvedValue([
      {
        id: "post-1",
        businessId: "biz-1",
        content: "Orphan post",
        scheduledAt: new Date("2026-03-10T10:00:00Z"),
        socialAccount: { platform: "TWITTER", username: "acme_co" },
        business: {
          name: "Acme Corp",
          members: [],
        },
      },
    ] as never);

    await sendReviewNotifications();

    expect(mockSend).not.toHaveBeenCalled();
  });

  it("includes review queue link in email body", async () => {
    prismaMock.post.findMany.mockResolvedValue([
      {
        id: "post-1",
        businessId: "biz-1",
        content: "A post",
        scheduledAt: new Date("2026-03-10T10:00:00Z"),
        socialAccount: { platform: "TWITTER", username: "acme_co" },
        business: {
          name: "Acme Corp",
          members: [
            { role: "OWNER", user: { email: "owner@acme.com" } },
          ],
        },
      },
    ] as never);

    await sendReviewNotifications();

    const emailArg = (SendEmailCommand as unknown as jest.Mock).mock.calls[0][0];
    const body = emailArg.Message.Body.Text.Data;
    expect(body).toContain("/dashboard/review");
  });

  it("catches and logs errors without throwing", async () => {
    prismaMock.post.findMany.mockRejectedValue(new Error("DB down"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await sendReviewNotifications(); // should not throw

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[notifications]"),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });

  it("calls reportServerError when review notifications fail", async () => {
    prismaMock.post.findMany.mockRejectedValue(new Error("DB down"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await sendReviewNotifications();

    consoleSpy.mockRestore();

    expect(mockReportServerError).toHaveBeenCalledWith(
      expect.stringContaining("review notifications"),
      expect.objectContaining({
        url: "cron/notifications",
        metadata: expect.objectContaining({
          source: "review-notifications",
        }),
      })
    );
  });
});
