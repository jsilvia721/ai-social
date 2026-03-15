"use client";

import { cn } from "@/lib/utils";

export interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  screenshotUrl?: string;
  isStreaming?: boolean;
}

/**
 * Individual chat message bubble.
 * User messages are right-aligned with blue background.
 * Assistant messages are left-aligned with dark background.
 */
export function ChatMessage({
  role,
  content,
  screenshotUrl,
  isStreaming,
}: ChatMessageProps) {
  const isUser = role === "user";

  return (
    <div
      data-testid="chat-message"
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
      {...(!isUser && { "aria-live": "polite" })}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-blue-600 text-white rounded-br-md"
            : "bg-zinc-800 text-zinc-100 rounded-bl-md"
        )}
      >
        <p className="whitespace-pre-wrap break-words">
          {content}
          {isStreaming && (
            <span
              data-testid="streaming-cursor"
              className="inline-block w-0.5 h-4 bg-zinc-400 animate-pulse ml-0.5 align-text-bottom"
            />
          )}
        </p>
        {screenshotUrl && (
          <img
            src={screenshotUrl}
            alt="Screenshot attachment"
            className="mt-2 rounded-lg max-w-full max-h-48 object-contain"
          />
        )}
      </div>
    </div>
  );
}
