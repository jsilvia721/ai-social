import crypto from "crypto";
import { verifyReplicateWebhook } from "@/lib/webhook";

// Helper to generate valid Standard Webhooks headers
function makeSignature(
  body: string,
  secret: string,
  options?: {
    webhookId?: string;
    timestamp?: number;
  }
) {
  const webhookId = options?.webhookId ?? "msg_test123";
  const timestamp = options?.timestamp ?? Math.floor(Date.now() / 1000);

  const keyBase64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = Buffer.from(keyBase64, "base64");

  const signedContent = `${webhookId}.${timestamp}.${body}`;
  const sig = crypto.createHmac("sha256", key).update(signedContent).digest("base64");

  return {
    headers: {
      "webhook-id": webhookId,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": `v1,${sig}`,
    },
    webhookId,
    timestamp,
  };
}

const TEST_SECRET = "whsec_" + Buffer.from("test-secret-key-1234567890").toString("base64");
const TEST_BODY = JSON.stringify({ id: "pred_123", status: "succeeded" });

describe("verifyReplicateWebhook", () => {
  it("accepts a valid signature", () => {
    const { headers } = makeSignature(TEST_BODY, TEST_SECRET);

    const result = verifyReplicateWebhook(TEST_BODY, headers, TEST_SECRET);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.body).toBe(TEST_BODY);
    }
  });

  it("rejects missing webhook-id header", () => {
    const { headers } = makeSignature(TEST_BODY, TEST_SECRET);
    delete (headers as Record<string, string | undefined>)["webhook-id"];

    const result = verifyReplicateWebhook(TEST_BODY, headers, TEST_SECRET);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Missing required webhook headers");
    }
  });

  it("rejects missing webhook-timestamp header", () => {
    const { headers } = makeSignature(TEST_BODY, TEST_SECRET);
    delete (headers as Record<string, string | undefined>)["webhook-timestamp"];

    const result = verifyReplicateWebhook(TEST_BODY, headers, TEST_SECRET);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Missing required webhook headers");
    }
  });

  it("rejects missing webhook-signature header", () => {
    const { headers } = makeSignature(TEST_BODY, TEST_SECRET);
    delete (headers as Record<string, string | undefined>)["webhook-signature"];

    const result = verifyReplicateWebhook(TEST_BODY, headers, TEST_SECRET);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Missing required webhook headers");
    }
  });

  it("rejects an invalid signature", () => {
    const { headers } = makeSignature(TEST_BODY, TEST_SECRET);
    headers["webhook-signature"] = "v1,invalidbase64signature==";

    const result = verifyReplicateWebhook(TEST_BODY, headers, TEST_SECRET);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid webhook signature");
    }
  });

  it("rejects a tampered body", () => {
    const { headers } = makeSignature(TEST_BODY, TEST_SECRET);
    const tamperedBody = JSON.stringify({ id: "pred_456", status: "failed" });

    const result = verifyReplicateWebhook(tamperedBody, headers, TEST_SECRET);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid webhook signature");
    }
  });

  it("rejects an expired timestamp (> 5 minutes old)", () => {
    const sixMinutesAgo = Math.floor(Date.now() / 1000) - 360;
    const { headers } = makeSignature(TEST_BODY, TEST_SECRET, { timestamp: sixMinutesAgo });

    const result = verifyReplicateWebhook(TEST_BODY, headers, TEST_SECRET);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("too old");
    }
  });

  it("rejects a future timestamp (> 5 minutes ahead)", () => {
    const sixMinutesFromNow = Math.floor(Date.now() / 1000) + 360;
    const { headers } = makeSignature(TEST_BODY, TEST_SECRET, { timestamp: sixMinutesFromNow });

    const result = verifyReplicateWebhook(TEST_BODY, headers, TEST_SECRET);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("too old or too far in the future");
    }
  });

  it("rejects an invalid (non-numeric) timestamp", () => {
    const { headers } = makeSignature(TEST_BODY, TEST_SECRET);
    headers["webhook-timestamp"] = "not-a-number";

    const result = verifyReplicateWebhook(TEST_BODY, headers, TEST_SECRET);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid webhook timestamp");
    }
  });

  it("handles secret without whsec_ prefix", () => {
    const rawSecret = Buffer.from("test-secret-key-1234567890").toString("base64");
    const { headers } = makeSignature(TEST_BODY, rawSecret);

    const result = verifyReplicateWebhook(TEST_BODY, headers, rawSecret);

    expect(result.valid).toBe(true);
  });

  it("handles multiple signatures (space-separated)", () => {
    const { headers } = makeSignature(TEST_BODY, TEST_SECRET);
    // Prepend an invalid signature — should still match the valid one
    headers["webhook-signature"] = `v1,invalidsig== ${headers["webhook-signature"]}`;

    const result = verifyReplicateWebhook(TEST_BODY, headers, TEST_SECRET);

    expect(result.valid).toBe(true);
  });

  it("ignores non-v1 signature versions", () => {
    const { headers } = makeSignature(TEST_BODY, TEST_SECRET);
    // Replace with v2 prefix — should not match
    headers["webhook-signature"] = headers["webhook-signature"].replace("v1,", "v2,");

    const result = verifyReplicateWebhook(TEST_BODY, headers, TEST_SECRET);

    expect(result.valid).toBe(false);
  });
});
