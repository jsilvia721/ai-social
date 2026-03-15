/**
 * Standard Webhooks signature verification for Replicate webhooks.
 *
 * Standard Webhooks format:
 *   - Headers: webhook-id, webhook-timestamp, webhook-signature
 *   - Secret: whsec_<base64key> — strip prefix, base64-decode for raw HMAC key
 *   - Signed content: `${webhookId}.${timestamp}.${rawBody}`
 *   - Signature: v1,<base64(hmac-sha256)>
 *   - Replay protection: reject if timestamp > 5 minutes old
 */

import crypto from "crypto";

const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60; // 5 minutes

export interface WebhookVerificationResult {
  valid: true;
  body: string;
}

export interface WebhookVerificationError {
  valid: false;
  error: string;
}

/**
 * Verify a Standard Webhooks signature from Replicate.
 *
 * @param rawBody  — raw request body string (must NOT be re-serialized)
 * @param headers  — object with webhook-id, webhook-timestamp, webhook-signature
 * @param secret   — the webhook secret in whsec_<base64> format
 * @returns verification result with body on success, or error on failure
 */
export function verifyReplicateWebhook(
  rawBody: string,
  headers: {
    "webhook-id"?: string | null;
    "webhook-timestamp"?: string | null;
    "webhook-signature"?: string | null;
  },
  secret: string
): WebhookVerificationResult | WebhookVerificationError {
  const webhookId = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signature = headers["webhook-signature"];

  if (!webhookId || !timestamp || !signature) {
    return { valid: false, error: "Missing required webhook headers" };
  }

  // Validate timestamp (replay protection)
  const timestampSeconds = parseInt(timestamp, 10);
  if (isNaN(timestampSeconds)) {
    return { valid: false, error: "Invalid webhook timestamp" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSeconds) > TIMESTAMP_TOLERANCE_SECONDS) {
    return { valid: false, error: "Webhook timestamp too old or too far in the future" };
  }

  // Extract raw HMAC key from whsec_ prefixed secret
  const keyBase64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = Buffer.from(keyBase64, "base64");

  // Compute expected signature
  const signedContent = `${webhookId}.${timestamp}.${rawBody}`;
  const expectedSig = crypto
    .createHmac("sha256", key)
    .update(signedContent)
    .digest("base64");

  // Parse and compare each signature (comma-separated, each prefixed with v1,)
  const signatures = signature.split(" ");
  for (const sig of signatures) {
    const parts = sig.split(",");
    if (parts.length < 2 || parts[0] !== "v1") continue;

    const sigValue = parts.slice(1).join(","); // rejoin in case base64 contains commas
    const expectedBuf = Buffer.from(expectedSig, "base64");
    const actualBuf = Buffer.from(sigValue, "base64");

    // Both buffers should be 32 bytes (SHA-256 output). Guard length for timingSafeEqual.
    if (expectedBuf.length === 32 && actualBuf.length === 32 && crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return { valid: true, body: rawBody };
    }
  }

  return { valid: false, error: "Invalid webhook signature" };
}
