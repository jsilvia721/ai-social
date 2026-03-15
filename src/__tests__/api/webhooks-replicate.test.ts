import crypto from "crypto";
import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
jest.mock("@/lib/video");
jest.mock("@/lib/server-error-reporter", () => ({
  reportServerError: jest.fn(),
}));

import { POST } from "@/app/api/webhooks/replicate/route";
import { processCompletedPrediction } from "@/lib/video";
import { NextRequest } from "next/server";

const mockProcessPrediction = processCompletedPrediction as jest.MockedFunction<
  typeof processCompletedPrediction
>;

// Test secret — must match the value set in src/__tests__/setup.ts
const TEST_SECRET = "whsec_" + Buffer.from("test-webhook-secret-key-12345").toString("base64");

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function signBody(
  body: string,
  secret: string = TEST_SECRET,
  options?: { webhookId?: string; timestamp?: number }
) {
  const webhookId = options?.webhookId ?? "msg_test123";
  const timestamp = options?.timestamp ?? Math.floor(Date.now() / 1000);

  const keyBase64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const key = Buffer.from(keyBase64, "base64");

  const signedContent = `${webhookId}.${timestamp}.${body}`;
  const sig = crypto.createHmac("sha256", key).update(signedContent).digest("base64");

  return {
    "webhook-id": webhookId,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `v1,${sig}`,
  };
}

function makeWebhookRequest(
  body: object,
  headers?: Record<string, string>
): NextRequest {
  const rawBody = JSON.stringify(body);
  const signedHeaders = headers ?? signBody(rawBody);

  return new NextRequest("http://localhost/api/webhooks/replicate", {
    method: "POST",
    body: rawBody,
    headers: {
      "Content-Type": "application/json",
      ...signedHeaders,
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/replicate", () => {
  describe("signature verification", () => {
    it("returns 401 for missing signature headers", async () => {
      const req = new NextRequest("http://localhost/api/webhooks/replicate", {
        method: "POST",
        body: JSON.stringify({ id: "pred_1", status: "succeeded" }),
        headers: { "Content-Type": "application/json" },
      });

      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Missing required webhook headers");
    });

    it("returns 401 for invalid signature", async () => {
      const req = new NextRequest("http://localhost/api/webhooks/replicate", {
        method: "POST",
        body: JSON.stringify({ id: "pred_1", status: "succeeded" }),
        headers: {
          "Content-Type": "application/json",
          "webhook-id": "msg_123",
          "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
          "webhook-signature": "v1,invalidsignature==",
        },
      });

      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid webhook signature");
    });

    it("returns 401 for expired timestamp", async () => {
      const body = JSON.stringify({ id: "pred_1", status: "succeeded" });
      const sixMinutesAgo = Math.floor(Date.now() / 1000) - 360;
      const headers = signBody(body, TEST_SECRET, { timestamp: sixMinutesAgo });

      const req = new NextRequest("http://localhost/api/webhooks/replicate", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      });

      const res = await POST(req);

      expect(res.status).toBe(401);
    });
  });

  describe("non-terminal statuses", () => {
    it("ignores 'processing' status", async () => {
      const prediction = { id: "pred_1", status: "processing" };
      const req = makeWebhookRequest(prediction);

      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ignored");
    });

    it("ignores 'starting' status", async () => {
      const prediction = { id: "pred_1", status: "starting" };
      const req = makeWebhookRequest(prediction);

      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ignored");
    });
  });

  describe("failed/canceled predictions", () => {
    it("marks brief as FAILED for failed prediction", async () => {
      const prediction = { id: "pred_1", status: "failed", error: "GPU OOM" };
      const req = makeWebhookRequest(prediction);

      prismaMock.contentBrief.findUnique.mockResolvedValue({
        id: "brief-1",
        status: "RENDERING",
        replicatePredictionId: "pred_1",
      } as any);
      prismaMock.contentBrief.update.mockResolvedValue({} as any);

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(prismaMock.contentBrief.update).toHaveBeenCalledWith({
        where: { id: "brief-1" },
        data: { status: "FAILED", errorMessage: "GPU OOM" },
      });
    });

    it("marks brief as FAILED for canceled prediction", async () => {
      const prediction = { id: "pred_1", status: "canceled" };
      const req = makeWebhookRequest(prediction);

      prismaMock.contentBrief.findUnique.mockResolvedValue({
        id: "brief-1",
        status: "RENDERING",
        replicatePredictionId: "pred_1",
      } as any);
      prismaMock.contentBrief.update.mockResolvedValue({} as any);

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(prismaMock.contentBrief.update).toHaveBeenCalledWith({
        where: { id: "brief-1" },
        data: { status: "FAILED", errorMessage: "Prediction canceled" },
      });
    });

    it("does not update brief that is not in RENDERING/FULFILLING status", async () => {
      const prediction = { id: "pred_1", status: "failed", error: "error" };
      const req = makeWebhookRequest(prediction);

      prismaMock.contentBrief.findUnique.mockResolvedValue({
        id: "brief-1",
        status: "FULFILLED", // already done
        replicatePredictionId: "pred_1",
      } as any);

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(prismaMock.contentBrief.update).not.toHaveBeenCalled();
    });
  });

  describe("succeeded predictions", () => {
    it("claims brief via atomic RENDERING → FULFILLING and processes", async () => {
      const prediction = {
        id: "pred_1",
        status: "succeeded",
        output: "https://replicate.delivery/output/video.mp4",
      };
      const req = makeWebhookRequest(prediction);

      prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 } as any);
      prismaMock.contentBrief.findUnique.mockResolvedValue({
        id: "brief-1",
        businessId: "biz-1",
        replicatePredictionId: "pred_1",
        status: "FULFILLING",
        business: {
          contentStrategy: { reviewWindowEnabled: false },
          socialAccounts: [{ id: "acc-1", platform: "TIKTOK" }],
        },
      } as any);
      mockProcessPrediction.mockResolvedValue({
        outcome: "created",
        postId: "post-1",
      });

      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("created");
      expect(body.postId).toBe("post-1");

      // Verify atomic claim
      expect(prismaMock.contentBrief.updateMany).toHaveBeenCalledWith({
        where: { replicatePredictionId: "pred_1", status: "RENDERING" },
        data: { status: "FULFILLING" },
      });
    });

    it("returns 200 for already-processed prediction (idempotent)", async () => {
      const prediction = {
        id: "pred_1",
        status: "succeeded",
        output: "https://replicate.delivery/output/video.mp4",
      };
      const req = makeWebhookRequest(prediction);

      // Atomic claim returns 0 — already processed
      prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 0 } as any);

      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("already_processed");
      expect(mockProcessPrediction).not.toHaveBeenCalled();
    });

    it("handles array output (takes first element)", async () => {
      const prediction = {
        id: "pred_1",
        status: "succeeded",
        output: ["https://replicate.delivery/output/video.mp4"],
      };
      const req = makeWebhookRequest(prediction);

      prismaMock.contentBrief.updateMany.mockResolvedValue({ count: 1 } as any);
      prismaMock.contentBrief.findUnique.mockResolvedValue({ id: "brief-1" } as any);
      mockProcessPrediction.mockResolvedValue({ outcome: "created", postId: "post-1" });

      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(mockProcessPrediction).toHaveBeenCalledWith(
        expect.anything(),
        "https://replicate.delivery/output/video.mp4"
      );
    });

    it("returns 400 for succeeded prediction with no output", async () => {
      const prediction = { id: "pred_1", status: "succeeded", output: null };
      const req = makeWebhookRequest(prediction);

      const res = await POST(req);

      expect(res.status).toBe(400);
    });
  });

  describe("concurrent race condition", () => {
    it("only one of two concurrent deliveries gets processed", async () => {
      const prediction = {
        id: "pred_1",
        status: "succeeded",
        output: "https://replicate.delivery/output/video.mp4",
      };

      // First call claims, second returns 0
      prismaMock.contentBrief.updateMany
        .mockResolvedValueOnce({ count: 1 } as any)
        .mockResolvedValueOnce({ count: 0 } as any);

      prismaMock.contentBrief.findUnique.mockResolvedValue({ id: "brief-1" } as any);
      mockProcessPrediction.mockResolvedValue({ outcome: "created", postId: "post-1" });

      const [res1, res2] = await Promise.all([
        POST(makeWebhookRequest(prediction)),
        POST(makeWebhookRequest(prediction)),
      ]);

      const body1 = await res1.json();
      const body2 = await res2.json();

      // One should process, the other should be already_processed
      const statuses = [body1.status, body2.status].sort();
      expect(statuses).toEqual(["already_processed", "created"]);

      // processCompletedPrediction called exactly once
      expect(mockProcessPrediction).toHaveBeenCalledTimes(1);
    });
  });
});
