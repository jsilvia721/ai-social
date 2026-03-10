/**
 * Shared SES alert utilities — used by scheduler and fulfillment engine.
 */
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { env } from "@/env";

export async function sendFailureAlert(
  ownerEmail: string,
  subject: string,
  body: string,
): Promise<void> {
  try {
    if (!env.SES_FROM_EMAIL) return;

    const ses = new SESClient({ region: "us-east-1" });
    await ses.send(
      new SendEmailCommand({
        Source: env.SES_FROM_EMAIL,
        Destination: { ToAddresses: [ownerEmail] },
        Message: {
          Subject: { Data: subject },
          Body: { Text: { Data: body } },
        },
      })
    );
  } catch {
    // Best-effort — never let an alert failure cascade
  }
}
