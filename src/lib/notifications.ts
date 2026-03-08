/**
 * Notification helpers — SES email for brief digests.
 * Best-effort: failures are caught by the caller, never block pipelines.
 */
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { env } from "@/env";

interface BriefSummary {
  topic: string;
  platform: string;
  recommendedFormat: string;
  suggestedCaption: string;
  scheduledFor: Date;
}

export async function sendBriefDigest(
  toEmail: string,
  businessName: string,
  briefs: BriefSummary[]
): Promise<void> {
  if (!env.SES_FROM_EMAIL) return;

  const briefLines = briefs.map(
    (b) =>
      `• [${b.platform}] ${b.topic} (${b.recommendedFormat})\n` +
      `  Caption: ${b.suggestedCaption.slice(0, 120)}${b.suggestedCaption.length > 120 ? "..." : ""}\n` +
      `  Scheduled: ${b.scheduledFor.toUTCString()}`
  );

  const ses = new SESClient({ region: "us-east-1" });
  await ses.send(
    new SendEmailCommand({
      Source: env.SES_FROM_EMAIL,
      Destination: { ToAddresses: [toEmail] },
      Message: {
        Subject: {
          Data: `[AI Social] ${briefs.length} new content briefs for ${businessName}`,
        },
        Body: {
          Text: {
            Data: [
              `Hi! Your content briefs for ${businessName} are ready.`,
              ``,
              `${briefs.length} briefs generated:`,
              ``,
              ...briefLines,
              ``,
              `Log in to your dashboard to review and fulfill these briefs.`,
            ].join("\n"),
          },
        },
      },
    })
  );
}
