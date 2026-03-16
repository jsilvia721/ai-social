"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { MessageSquare, Loader2, Paperclip, Send, X, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChatMessage } from "./ChatMessage";
import { ChatSummary, type SummaryData, type FeedbackPriority } from "./ChatSummary";
import { TypingIndicator } from "./TypingIndicator";
import { EXCHANGE_CAP } from "@/lib/feedback-agent";
import type { FeedbackClassification } from "@/lib/feedback-formatter";

interface Message {
  role: "user" | "assistant";
  content: string;
  screenshotUrl?: string;
}

type StreamingState = "idle" | "waiting" | "streaming" | "error";

const MIN_MESSAGE_LENGTH = 2;

/**
 * Coerce an unknown error value to a human-readable string.
 * Handles Zod fieldErrors objects like `{ field: ["msg1", "msg2"] }`.
 */
function toErrorString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "object") {
    // Zod fieldErrors: { field: string[] }
    const entries = Object.entries(value as Record<string, unknown>);
    const messages = entries.flatMap(([, v]) =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []
    );
    if (messages.length > 0) return messages.join("; ");
  }
  return String(value);
}
const VALID_CLASSIFICATIONS: FeedbackClassification[] = ["bug", "feature", "general"];
const VALID_PRIORITIES: FeedbackPriority[] = ["low", "medium", "high", "critical"];

/**
 * Try to parse a summary JSON from assistant message content.
 * The AI may wrap the summary in a JSON block with type: "summary".
 * Performs runtime validation of all fields.
 */
function tryParseSummary(content: string): SummaryData | null {
  try {
    const parsed = JSON.parse(content);
    if (
      parsed?.type === "summary" &&
      typeof parsed.classification === "string" &&
      typeof parsed.title === "string" &&
      typeof parsed.description === "string" &&
      VALID_CLASSIFICATIONS.includes(parsed.classification)
    ) {
      const priority: FeedbackPriority =
        typeof parsed.priority === "string" &&
        VALID_PRIORITIES.includes(parsed.priority)
          ? parsed.priority
          : "medium";

      return {
        classification: parsed.classification,
        title: parsed.title,
        description: parsed.description,
        priority,
      };
    }
  } catch {
    // Not JSON — that's fine
  }
  return null;
}

/**
 * Parse SSE events from a streaming response body.
 */
async function consumeSSEStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";

      for (const event of events) {
        const trimmed = event.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);

        if (data === "[DONE]") {
          onDone();
          return;
        }

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "error") {
            onError(toErrorString(parsed.error) || "Stream error");
            return;
          }
          if (parsed.type === "text" && parsed.text) {
            onDelta(parsed.text);
          }
        } catch {
          // Skip unparseable events
        }
      }
    }
    onDone();
  } catch (err) {
    onError(err instanceof Error ? err.message : "Connection lost");
  }
}

export interface FeedbackChatProps {
  /** When provided, component renders without its own Dialog wrapper (embedded mode). */
  onClose?: () => void;
  /** Called when feedback is successfully submitted in embedded mode. */
  onSuccess?: (issueUrl?: string) => void;
}

export function FeedbackChat({ onClose, onSuccess }: FeedbackChatProps) {
  const embedded = !!onClose;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [streamingState, setStreamingState] = useState<StreamingState>("idle");
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ issueUrl?: string } | null>(null);
  const [screenshot, setScreenshot] = useState<{ url: string; name: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const userExchangeCount = messages.filter((m) => m.role === "user").length;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  function resetState() {
    abortControllerRef.current?.abort();
    setMessages([]);
    setInputValue("");
    setStreamingState("idle");
    setStreamingText("");
    setError(null);
    setSummary(null);
    setIsSubmitting(false);
    setSuccess(null);
    setScreenshot(null);
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleOpenChange(nextOpen: boolean) {
    if (embedded) {
      if (!nextOpen) {
        onClose?.();
      }
    } else {
      setOpen(nextOpen);
      if (!nextOpen) {
        resetState();
      }
    }
  }

  /** Send messages to the chat API and consume the SSE stream. */
  const sendToChat = useCallback(
    async (chatMessages: Message[]) => {
      setStreamingState("waiting");
      setStreamingText("");
      setError(null);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const apiMessages = chatMessages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const res = await fetch("/api/feedback/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: apiMessages,
            context: { pageUrl: window.location.href },
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          if (res.status === 429) {
            const retryAfter = res.headers.get("Retry-After");
            const seconds = retryAfter ? parseInt(retryAfter, 10) : 60;
            setError(
              `Please slow down — try again in ${seconds} second${seconds !== 1 ? "s" : ""}.`
            );
            setStreamingState("error");
            return;
          }

          const data = await res.json().catch(() => ({ error: "Request failed" }));
          setError(toErrorString(data.error) || "Request failed");
          setStreamingState("error");
          return;
        }

        if (!res.body) {
          setError("No response stream");
          setStreamingState("error");
          return;
        }

        let fullText = "";
        setStreamingState("streaming");

        await consumeSSEStream(
          res.body,
          (text) => {
            fullText += text;
            setStreamingText(fullText);
          },
          () => {
            // Done — finalize as assistant message
            const summaryData = tryParseSummary(fullText);
            if (summaryData) {
              setSummary(summaryData);
            }

            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: fullText },
            ]);
            setStreamingText("");
            setStreamingState("idle");
          },
          (errMsg) => {
            // Mid-stream error — keep partial text visible
            if (fullText) {
              setMessages((prev) => [
                ...prev,
                { role: "assistant", content: fullText },
              ]);
              setStreamingText("");
            }
            setError(errMsg);
            setStreamingState("error");
          }
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Connection failed");
        setStreamingState("error");
      }
    },
    []
  );

  /** Fetch the initial greeting when the dialog opens (or on mount in embedded mode). */
  useEffect(() => {
    const shouldFetch = embedded || open;
    if (shouldFetch && messages.length === 0 && streamingState === "idle") {
      // Send a greeting request — the API expects at least one user message,
      // so we send a minimal "hi" that the system prompt will respond to
      const greetingMessages: Message[] = [{ role: "user", content: "hi" }];
      sendToChat(greetingMessages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, embedded]);

  function handleSendMessage() {
    const trimmed = inputValue.trim();
    if (trimmed.length < MIN_MESSAGE_LENGTH || streamingState !== "idle") return;

    const userMessage: Message = {
      role: "user",
      content: trimmed,
      ...(screenshot && { screenshotUrl: screenshot.url }),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputValue("");
    setScreenshot(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    sendToChat(newMessages);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  }

  function handleRetry() {
    if (messages.length === 0) return;
    setError(null);
    // Re-send the current messages to get a new response
    sendToChat(messages);
  }

  function handleWrapUp() {
    // Add a user message asking to wrap up, then send
    const wrapUpMessage: Message = {
      role: "user",
      content:
        "Please summarize our conversation and present a final summary for me to review.",
    };
    const newMessages = [...messages, wrapUpMessage];
    setMessages(newMessages);
    sendToChat(newMessages);
  }

  async function handleScreenshotUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(toErrorString(data.error) || "Upload failed");
      }

      const data = await res.json();
      setScreenshot({ url: data.url, name: file.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setIsUploading(false);
    }
  }

  function removeScreenshot() {
    setScreenshot(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleConfirmSummary() {
    if (!summary || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/feedback/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          summary: summary.description,
          classification: summary.classification,
          context: {
            pageUrl: window.location.href,
            ...(screenshot && { screenshotUrl: screenshot.url }),
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Submit failed" }));
        throw new Error(toErrorString(data.error) || "Submit failed");
      }

      const data = await res.json();
      setSuccess({ issueUrl: data.githubIssueUrl });
      onSuccess?.(data.githubIssueUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCorrectSummary() {
    setSummary(null);
    // Add a system-level correction prompt as user message
    const correctionMsg: Message = {
      role: "user",
      content: "That's not quite right. Let me clarify.",
    };
    const newMessages = [...messages, correctionMsg];
    setMessages(newMessages);
    sendToChat(newMessages);
    inputRef.current?.focus();
  }

  const canSend =
    inputValue.trim().length >= MIN_MESSAGE_LENGTH && streamingState === "idle";
  const showWrapUp = userExchangeCount >= 2 && !summary && streamingState === "idle";

  const chatContent = (
    <>
      {/* Header */}
      <DialogHeader className="flex-none border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <DialogTitle className="text-base">
              {embedded ? "Send Feedback" : "Feedback"}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Tell us what&apos;s on your mind
            </DialogDescription>
          </div>
          <div className="flex items-center gap-2">
            {userExchangeCount > 0 && (
              <span className="text-xs text-zinc-500">
                {userExchangeCount} of {EXCHANGE_CAP}
              </span>
            )}
            <button
              onClick={() => handleOpenChange(false)}
              className="rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2 focus:ring-offset-zinc-950"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </button>
          </div>
        </div>
      </DialogHeader>

      {success ? (
        /* Success state */
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-2">
            <p className="text-sm text-emerald-400 font-medium">
              Thank you for your feedback!
            </p>
            {success.issueUrl?.startsWith("https://github.com/") && (
              <a
                href={success.issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:underline inline-block"
              >
                View issue on GitHub
              </a>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Message list */}
          <div
            role="log"
            aria-label="Chat messages"
            className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0 md:min-h-[300px] md:max-h-[50vh]"
          >
            {messages.map((msg, i) => {
              // Don't render the initial "hi" greeting trigger
              if (i === 0 && msg.role === "user" && msg.content === "hi") {
                return null;
              }
              return (
                <ChatMessage
                  key={i}
                  role={msg.role}
                  content={msg.content}
                  screenshotUrl={msg.screenshotUrl}
                />
              );
            })}

            {/* Streaming text */}
            {streamingState === "streaming" && streamingText && (
              <ChatMessage
                role="assistant"
                content={streamingText}
                isStreaming
              />
            )}

            {/* Typing indicator */}
            {streamingState === "waiting" && <TypingIndicator />}

            {/* Summary card */}
            {summary && !success && (
              <ChatSummary
                summary={summary}
                onConfirm={handleConfirmSummary}
                onCorrect={handleCorrectSummary}
                isSubmitting={isSubmitting}
              />
            )}

            {/* Error display */}
            {error && (
              <div
                role="alert"
                className="flex items-center gap-2 rounded-lg bg-red-900/20 border border-red-800/50 px-3 py-2 text-sm text-red-400"
              >
                <span className="flex-1">{error}</span>
                {streamingState === "error" && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={handleRetry}
                    aria-label="Retry"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Retry
                  </Button>
                )}
              </div>
            )}

            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          {!summary && (
            <div className="flex-none border-t border-zinc-800 p-3 space-y-2 safe-area-bottom">
              {/* Screenshot preview */}
              {screenshot && (
                <div className="flex items-center gap-2 text-sm text-zinc-300 bg-zinc-800 rounded-md px-3 py-1.5">
                  <Paperclip className="h-3 w-3 text-zinc-400 flex-none" />
                  <span className="truncate flex-1 text-xs">
                    {screenshot.name}
                  </span>
                  <button
                    type="button"
                    onClick={removeScreenshot}
                    className="text-zinc-500 hover:text-zinc-300 flex-none"
                    aria-label="Remove screenshot"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Wrap up button */}
              {showWrapUp && (
                <div className="flex justify-center">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={handleWrapUp}
                    aria-label="Wrap up"
                  >
                    Wrap up
                  </Button>
                </div>
              )}

              <div className="flex items-end gap-2">
                {/* Paperclip button */}
                <label
                  className="flex-none cursor-pointer text-zinc-400 hover:text-zinc-300 transition-colors p-1"
                  aria-label="Attach screenshot"
                >
                  {isUploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Paperclip className="h-4 w-4" />
                  )}
                  <input
                    ref={fileInputRef}
                    data-testid="chat-screenshot-input"
                    type="file"
                    accept="image/*"
                    onChange={handleScreenshotUpload}
                    className="hidden"
                    disabled={isUploading}
                  />
                </label>

                {/* Text input */}
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type your message..."
                  rows={1}
                  className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-h-[38px] max-h-[120px]"
                  disabled={streamingState !== "idle"}
                />

                {/* Send button */}
                <Button
                  size="icon-sm"
                  onClick={handleSendMessage}
                  disabled={!canSend}
                  aria-label="Send"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );

  // In embedded mode, render content directly (parent manages Dialog)
  if (embedded) {
    return chatContent;
  }

  // Standalone mode: render with own Dialog wrapper
  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <button
            className="flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-950 min-w-[44px] min-h-[44px]"
            aria-label="Feedback"
          >
            <MessageSquare className="h-4 w-4" />
            <span className="hidden sm:inline">Feedback</span>
          </button>
        </DialogTrigger>

        <DialogContent
          className="flex flex-col fixed inset-0 max-w-none translate-x-0 translate-y-0 top-0 left-0 rounded-none h-dvh w-dvw md:inset-auto md:top-[50%] md:left-[50%] md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-lg md:h-auto md:max-h-[80vh] md:w-full md:max-w-lg p-0"
          showCloseButton={false}
        >
          {chatContent}
        </DialogContent>
      </Dialog>
    </div>
  );
}
