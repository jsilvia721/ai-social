jest.mock("next-auth/next", () => ({
  getServerSession: jest.fn(),
}));
jest.mock("@/lib/auth", () => ({
  authOptions: {},
}));
jest.mock("@/lib/system-metrics", () => ({
  trackApiCall: jest.fn(),
}));
jest.mock("@/lib/mocks/config", () => ({
  shouldMockExternalApis: jest.fn(),
}));

// Mock Anthropic SDK with a controllable stream
const mockStreamIterator = jest.fn();
const mockAbort = jest.fn();
const mockFinalMessage = jest.fn();
jest.mock("@anthropic-ai/sdk", () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      stream: jest.fn().mockImplementation(() => {
        const streamObj = {
          [Symbol.asyncIterator]: () => mockStreamIterator(),
          abort: mockAbort,
          finalMessage: mockFinalMessage,
        };
        return streamObj;
      }),
    },
  }));
});

import { POST } from "@/app/api/feedback/chat/route";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { trackApiCall } from "@/lib/system-metrics";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import { _resetAllLimits } from "@/lib/rate-limit";

const mockGetServerSession = getServerSession as jest.MockedFunction<
  typeof getServerSession
>;
const mockShouldMock = shouldMockExternalApis as jest.MockedFunction<
  typeof shouldMockExternalApis
>;
const mockTrackApiCall = trackApiCall as jest.MockedFunction<
  typeof trackApiCall
>;

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/feedback/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(rawBody: string) {
  return new NextRequest("http://localhost/api/feedback/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    messages: [{ role: "user", content: "I found a bug" }],
    context: { pageUrl: "https://app.example.com/dashboard" },
    ...overrides,
  };
}

interface SSEEvent {
  type: "text" | "error" | "done" | "unknown";
  data: string;
}

async function readSSEStream(
  response: Response
): Promise<{ events: SSEEvent[]; raw: string }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  const events: SSEEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }

  // Parse SSE events from raw text
  const lines = raw.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const data = line.slice(6);
      if (data === "[DONE]") {
        events.push({ type: "done", data });
      } else {
        try {
          const parsed = JSON.parse(data);
          events.push({ type: parsed.type ?? "unknown", data });
        } catch {
          events.push({ type: "unknown", data });
        }
      }
    }
  }

  return { events, raw };
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetAllLimits();
  mockGetServerSession.mockResolvedValue({
    user: { id: "user-1", name: "Josh", email: "josh@example.com" },
    expires: "2099-01-01",
  });
  mockShouldMock.mockReturnValue(true);
});

describe("POST /api/feedback/chat", () => {
  // ── Auth ─────────────────────────────────────────────────────────────

  it("returns 401 without session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await POST(makeRequest(validPayload()));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  // ── Validation ───────────────────────────────────────────────────────

  it("returns 400 for invalid JSON body", async () => {
    const res = await POST(makeRawRequest("not json"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
  });

  it("returns 400 for missing messages", async () => {
    const res = await POST(
      makeRequest({ context: { pageUrl: "https://example.com" } })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing context", async () => {
    const res = await POST(
      makeRequest({ messages: [{ role: "user", content: "hello" }] })
    );
    expect(res.status).toBe(400);
  });

  it("returns error as a string (not object) for Zod validation failure", async () => {
    // Send messages with invalid structure to trigger Zod fieldErrors
    const res = await POST(
      makeRequest({
        messages: [{ role: 123, content: false }],
        context: { pageUrl: "not-a-url" },
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
    // Ensure it's a meaningful message, not "[object Object]"
    expect(body.error).not.toContain("[object Object]");
    expect(body.error).toMatch(/expected|invalid|required/i);
  });

  it("returns 400 when messages do not alternate correctly", async () => {
    const res = await POST(
      makeRequest(
        validPayload({
          messages: [
            { role: "user", content: "first" },
            { role: "user", content: "second" },
          ],
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when last message is not from user", async () => {
    const res = await POST(
      makeRequest(
        validPayload({
          messages: [
            { role: "user", content: "hello" },
            { role: "assistant", content: "hi there" },
          ],
        })
      )
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages exceed 20 total", async () => {
    const messages = [];
    for (let i = 0; i < 21; i++) {
      messages.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
      });
    }
    const res = await POST(makeRequest(validPayload({ messages })));
    expect(res.status).toBe(400);
  });

  it("returns 400 when a single message content exceeds 5000 chars", async () => {
    const res = await POST(
      makeRequest(
        validPayload({
          messages: [{ role: "user", content: "x".repeat(5001) }],
        })
      )
    );
    expect(res.status).toBe(400);
  });

  // ── Exchange cap ────────────────────────────────────────────────────

  it("allows messages at the exchange cap boundary (10 user messages)", async () => {
    // With alternating messages + last=user + max 20, the maximum possible
    // user messages is 10 (19 messages: u,a,u,a,...,u). The exchange cap
    // (countUserMessages > 10) acts as defense-in-depth — the schema
    // constraints prevent it from being triggered in practice, but the code
    // check exists as a guard. This test verifies the boundary is accepted.
    const messages = [];
    for (let i = 0; i < 19; i++) {
      messages.push({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `msg ${i}`,
      });
    }
    const res = await POST(makeRequest(validPayload({ messages })));
    // 10 user messages is at the cap, not over — should stream successfully
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });

  // ── Rate limiting ──────────────────────────────────────────────────

  it("returns 429 when rate limited with Retry-After header", async () => {
    for (let i = 0; i < 10; i++) {
      await POST(makeRequest(validPayload()));
    }

    const res = await POST(makeRequest(validPayload()));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("does not rate-limit follow-up messages (user count > 1)", async () => {
    for (let i = 0; i < 10; i++) {
      await POST(makeRequest(validPayload()));
    }

    const followUp = validPayload({
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "hi" },
        { role: "user", content: "follow up" },
      ],
    });
    const res = await POST(makeRequest(followUp));
    expect(res.status).not.toBe(429);
  });

  // ── Mock streaming ────────────────────────────────────────────────

  it("returns SSE stream with text events and [DONE] in mock mode", async () => {
    mockShouldMock.mockReturnValue(true);
    const res = await POST(makeRequest(validPayload()));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");

    const { events } = await readSSEStream(res);

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents.length).toBeGreaterThan(0);

    const doneEvents = events.filter((e) => e.type === "done");
    expect(doneEvents.length).toBe(1);

    for (const evt of textEvents) {
      const parsed = JSON.parse(evt.data);
      expect(parsed.type).toBe("text");
      expect(typeof parsed.text).toBe("string");
    }
  });

  it("calls trackApiCall after mock stream completes", async () => {
    mockShouldMock.mockReturnValue(true);
    const res = await POST(makeRequest(validPayload()));
    await readSSEStream(res);

    expect(mockTrackApiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "anthropic",
        endpoint: "feedbackChat",
        statusCode: 200,
      })
    );
  });

  // ── Anthropic streaming (non-mock) ────────────────────────────────

  it("streams Claude response as SSE events via Anthropic SDK", async () => {
    mockShouldMock.mockReturnValue(false);

    // Set up mock stream to yield text deltas
    const chunks = [
      {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello " },
      },
      {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "there!" },
      },
      { type: "message_stop" }, // non-text event should be ignored
    ];

    mockStreamIterator.mockReturnValue({
      next: jest
        .fn()
        .mockResolvedValueOnce({ value: chunks[0], done: false })
        .mockResolvedValueOnce({ value: chunks[1], done: false })
        .mockResolvedValueOnce({ value: chunks[2], done: false })
        .mockResolvedValueOnce({ value: undefined, done: true }),
    });

    mockFinalMessage.mockResolvedValue({
      usage: { input_tokens: 50, output_tokens: 25 },
    });

    const res = await POST(makeRequest(validPayload()));
    expect(res.status).toBe(200);

    const { events } = await readSSEStream(res);

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(2);
    expect(JSON.parse(textEvents[0].data).text).toBe("Hello ");
    expect(JSON.parse(textEvents[1].data).text).toBe("there!");

    expect(events[events.length - 1].type).toBe("done");
  });

  it("tracks token usage from Anthropic stream finalMessage", async () => {
    mockShouldMock.mockReturnValue(false);

    mockStreamIterator.mockReturnValue({
      next: jest.fn().mockResolvedValueOnce({ value: undefined, done: true }),
    });

    mockFinalMessage.mockResolvedValue({
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const res = await POST(makeRequest(validPayload()));
    await readSSEStream(res);

    expect(mockTrackApiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "anthropic",
        endpoint: "feedbackChat",
        statusCode: 200,
        metadata: { inputTokens: 100, outputTokens: 50 },
      })
    );
  });

  it("sends error SSE event when Anthropic stream throws", async () => {
    mockShouldMock.mockReturnValue(false);

    mockStreamIterator.mockReturnValue({
      next: jest.fn().mockRejectedValue(new Error("API overloaded")),
    });

    mockFinalMessage.mockRejectedValue(new Error("Stream failed"));

    const res = await POST(makeRequest(validPayload()));
    const { events } = await readSSEStream(res);

    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    // Error message should be generic (not leak Anthropic SDK details)
    expect(JSON.parse(errorEvents[0].data).error).toBe(
      "An error occurred processing your request"
    );

    // trackApiCall should record the error
    expect(mockTrackApiCall).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "anthropic",
        endpoint: "feedbackChat",
        error: "API overloaded",
      })
    );
  });

  // ── SSE format ────────────────────────────────────────────────────

  it("sets correct SSE headers", async () => {
    const res = await POST(makeRequest(validPayload()));

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    expect(res.headers.get("X-Accel-Buffering")).toBe("no");
  });

  // ── force-dynamic export ──────────────────────────────────────────

  it("exports dynamic = force-dynamic", async () => {
    const routeModule = await import("@/app/api/feedback/chat/route");
    expect(routeModule.dynamic).toBe("force-dynamic");
  });
});
