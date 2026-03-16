/**
 * Centralized AI model configuration and client singleton.
 *
 * All AI call sites import model constants and the shared Anthropic client
 * from here instead of creating per-file instances.
 */
import Anthropic from "@anthropic-ai/sdk";

// ── Model constants ─────────────────────────────────────────────────────────

/** Claude Sonnet 4.6 — default for structured output, tool use, complex reasoning */
export const MODEL_DEFAULT = "claude-sonnet-4-6" as const;

/** Claude Haiku 4.5 — fast/cheap for simple text generation */
export const MODEL_FAST = "claude-haiku-4-5-20251001" as const;

/** Union of all supported model IDs */
export type ModelId = typeof MODEL_DEFAULT | typeof MODEL_FAST;

/**
 * Get the model ID for a given tier.
 */
export function getModel(tier: "default" | "fast"): ModelId {
  return tier === "fast" ? MODEL_FAST : MODEL_DEFAULT;
}

// ── Lazy client singleton ───────────────────────────────────────────────────
// Follows the same globalThis pattern as src/lib/db.ts to survive Next.js
// hot-module-replacement in dev. In Lambda, module caching ensures one client
// per cold start regardless.

const globalForAnthropic = globalThis as unknown as { anthropicClient: Anthropic };

/**
 * Returns a shared Anthropic client instance. Created lazily on first call.
 */
export function getAnthropicClient(): Anthropic {
  if (!globalForAnthropic.anthropicClient) {
    globalForAnthropic.anthropicClient = new Anthropic();
  }
  return globalForAnthropic.anthropicClient;
}
