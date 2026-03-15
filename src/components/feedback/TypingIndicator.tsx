"use client";

/**
 * Three-dot typing indicator shown while waiting for AI response.
 */
export function TypingIndicator() {
  return (
    <div
      data-testid="typing-indicator"
      className="flex items-center gap-1.5 px-4 py-3"
      aria-label="AI is typing"
    >
      <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:0ms]" />
      <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:150ms]" />
      <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}
