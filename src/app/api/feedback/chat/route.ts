import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { checkRateLimit } from "@/lib/rate-limit";
import { trackApiCall } from "@/lib/system-metrics";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import {
  buildFeedbackSystemPrompt,
  countUserMessages,
  EXCHANGE_CAP,
} from "@/lib/feedback-agent";

export const dynamic = "force-dynamic";

/** Rate limit: 10 new conversations per hour per user. */
const RATE_LIMIT_OPTIONS = { maxRequests: 10, windowMs: 60 * 60 * 1000 };

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(5000),
});

const chatRequestSchema = z
  .object({
    messages: z
      .array(messageSchema)
      .min(1)
      .max(20)
      .refine(
        (msgs) => {
          // Messages must alternate: user, assistant, user, assistant, ...
          for (let i = 0; i < msgs.length; i++) {
            const expectedRole = i % 2 === 0 ? "user" : "assistant";
            if (msgs[i].role !== expectedRole) return false;
          }
          return true;
        },
        { message: "Messages must alternate starting with user" }
      )
      .refine((msgs) => msgs[msgs.length - 1].role === "user", {
        message: "Last message must be from user",
      }),
    context: z.object({
      pageUrl: z.string().url(),
    }),
  });

function formatSSEEvent(data: string): string {
  return `data: ${data}\n\n`;
}

function createMockStream(startMs: number): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const mockChunks = [
    "Thanks for ",
    "sharing that! ",
    "I'd love to help. ",
    "Could you tell me ",
    "more about what happened?",
  ];

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const chunk of mockChunks) {
          const event = formatSSEEvent(
            JSON.stringify({ type: "text", text: chunk })
          );
          controller.enqueue(encoder.encode(event));
        }
        controller.enqueue(encoder.encode(formatSSEEvent("[DONE]")));
      } catch (err) {
        const errorMsg =
          err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(
          encoder.encode(
            formatSSEEvent(JSON.stringify({ type: "error", error: errorMsg }))
          )
        );
      } finally {
        controller.close();
        trackApiCall({
          service: "anthropic",
          endpoint: "feedbackChat",
          statusCode: 200,
          latencyMs: Date.now() - startMs,
        });
      }
    },
  });
}

function createAnthropicStream(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  systemPrompt: string,
  startMs: number
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const client = new Anthropic();
  let stream: ReturnType<typeof client.messages.stream> | undefined;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let errorMessage: string | undefined;
      try {
        stream = client.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const sseEvent = formatSSEEvent(
              JSON.stringify({ type: "text", text: event.delta.text })
            );
            controller.enqueue(encoder.encode(sseEvent));
          }
        }

        controller.enqueue(encoder.encode(formatSSEEvent("[DONE]")));
      } catch (err) {
        errorMessage =
          err instanceof Error ? err.message : "Unknown error";
        try {
          // Send generic error to client; real error logged via trackApiCall
          controller.enqueue(
            encoder.encode(
              formatSSEEvent(
                JSON.stringify({
                  type: "error",
                  error: "An error occurred processing your request",
                })
              )
            )
          );
        } catch {
          // Controller may already be closed
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed
        }

        // Track API usage
        let tokenUsage: { inputTokens: number; outputTokens: number } | undefined;
        if (stream) {
          try {
            const finalMessage = await stream.finalMessage();
            tokenUsage = {
              inputTokens: finalMessage.usage.input_tokens,
              outputTokens: finalMessage.usage.output_tokens,
            };
          } catch {
            // Stream may have errored
          }
        }

        trackApiCall({
          service: "anthropic",
          endpoint: "feedbackChat",
          statusCode: errorMessage ? undefined : 200,
          latencyMs: Date.now() - startMs,
          error: errorMessage,
          metadata: tokenUsage,
        });
      }
    },
    cancel() {
      stream?.abort();
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = chatRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 }
    );
  }

  const { messages, context } = parsed.data;

  // Check exchange cap
  const userMsgCount = countUserMessages(messages);
  if (userMsgCount > EXCHANGE_CAP) {
    return Response.json(
      { error: "Conversation exchange limit reached" },
      { status: 400 }
    );
  }

  // Rate limit only on first user message (new conversation session)
  if (userMsgCount === 1) {
    const rateResult = checkRateLimit(session.user.id, RATE_LIMIT_OPTIONS);
    if (!rateResult.allowed) {
      const retryAfterSeconds = Math.ceil(rateResult.retryAfterMs / 1000);
      return Response.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
        }
      );
    }
  }

  const startMs = Date.now();

  // Build system prompt
  const systemPrompt = buildFeedbackSystemPrompt({
    pageUrl: context.pageUrl,
    userName: session.user.name ?? "there",
    features: ["Post Scheduling", "Analytics", "AI Content Generation"],
  });

  // Create the appropriate stream
  const readableStream = shouldMockExternalApis()
    ? createMockStream(startMs)
    : createAnthropicStream(messages, systemPrompt, startMs);

  return new Response(readableStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
