import { prismaMock, resetPrismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { POST } from "@/app/api/errors/route";
import { NextRequest } from "next/server";
import crypto from "crypto";
import type { ErrorReport } from "@prisma/client";
import { normalizeMessage } from "@/lib/normalize-error";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function fingerprint(source: string, message: string) {
  return crypto
    .createHash("sha256")
    .update(source + ":" + normalizeMessage(message))
    .digest("hex");
}

function mockReport(overrides: Partial<ErrorReport> = {}): ErrorReport {
  return {
    id: "err-1",
    fingerprint: "fp",
    message: "error",
    stack: null,
    source: "CLIENT",
    url: null,
    metadata: null,
    count: 1,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
    status: "NEW",
    githubIssueNumber: null,
    acknowledgedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  resetPrismaMock();
  jest.clearAllMocks();
});

describe("POST /api/errors", () => {
  const validPayload = {
    message: "Uncaught TypeError: Cannot read property 'foo' of undefined",
    stack:
      "TypeError: Cannot read property 'foo' of undefined\n    at Object.<anonymous>",
    source: "CLIENT",
    url: "http://localhost:3000/dashboard",
  };

  it("creates a new error report and returns 201", async () => {
    const fp = fingerprint("CLIENT", validPayload.message);
    prismaMock.errorReport.upsert.mockResolvedValue(
      mockReport({ id: "err-1", fingerprint: fp, count: 1 })
    );

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe("err-1");
    expect(body.fingerprint).toBe(fp);
    expect(body.count).toBe(1);

    expect(prismaMock.errorReport.upsert).toHaveBeenCalledWith({
      where: { fingerprint: fp },
      create: {
        fingerprint: fp,
        message: validPayload.message,
        stack: validPayload.stack,
        source: "CLIENT",
        url: validPayload.url,
        metadata: undefined,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: expect.any(Date),
        stack: validPayload.stack,
      },
    });
  });

  it("returns 200 when duplicate fingerprint increments count", async () => {
    const fp = fingerprint("CLIENT", validPayload.message);
    prismaMock.errorReport.upsert.mockResolvedValue(
      mockReport({ id: "err-1", fingerprint: fp, count: 5 })
    );

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe("err-1");
    expect(body.count).toBe(5);
  });

  it("returns 400 when message is missing", async () => {
    const res = await POST(
      makeRequest({ source: "CLIENT", url: "http://localhost" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when source is invalid", async () => {
    const res = await POST(
      makeRequest({ message: "some error", source: "UNKNOWN" })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 for malformed JSON body", async () => {
    const req = new NextRequest("http://localhost/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{{{",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("accepts SERVER source", async () => {
    const fp = fingerprint("SERVER", "server error");
    prismaMock.errorReport.upsert.mockResolvedValue(
      mockReport({ id: "err-2", fingerprint: fp, source: "SERVER", count: 1 })
    );

    const res = await POST(
      makeRequest({ message: "server error", source: "SERVER" })
    );
    expect(res.status).toBe(201);
  });

  it("accepts optional metadata", async () => {
    const fp = fingerprint("CLIENT", validPayload.message);
    const metadata = { userAgent: "Mozilla/5.0", viewport: "1024x768" };
    prismaMock.errorReport.upsert.mockResolvedValue(
      mockReport({ id: "err-3", fingerprint: fp, metadata, count: 1 })
    );

    const res = await POST(makeRequest({ ...validPayload, metadata }));
    expect(res.status).toBe(201);

    expect(prismaMock.errorReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ metadata }),
      })
    );
  });

  it("returns 500 when database fails", async () => {
    prismaMock.errorReport.upsert.mockRejectedValue(
      new Error("connection refused")
    );

    const res = await POST(makeRequest(validPayload));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to record error report");
  });
});
