---
title: "feat: Configurable Model Selection for AI Pipeline"
type: feat
status: active
date: 2026-03-16
---

# Configurable Model Selection for AI Pipeline

## Enhancement Summary

**Deepened on:** 2026-03-16
**Review agents used:** TypeScript Reviewer, Performance Oracle, Security Sentinel, Architecture Strategist, Code Simplicity Reviewer, Agent-Native Reviewer, Pattern Recognition Specialist, Agent-Native Architecture Skill, Best Practices Researcher

### Key Improvements from Deepening
1. **Simplified architecture** — dropped premature 3-tier abstraction in favor of two constants (`MODEL_DEFAULT`, `MODEL_FAST`). Opus tier deferred until first consumer exists.
2. **Kept `repurposeContent` on Sonnet** — performance review found multi-constraint structured output (forced tool_choice + platform rules + pillar mapping) is unreliable on Haiku. Only `generatePostContent` downgrades.
3. **Deprioritized prompt caching** — 5-min cache TTL is wasted on crons running every 4h/weekly. Moved to a separate future phase; only viable within single fulfillment batches.
4. **Lazy client initialization** — follows existing `src/lib/db.ts` Prisma pattern; avoids coupling test imports to API key env var.
5. **Fixed 3 pre-existing gaps** discovered during review: missing Zod validation in `analyzePerformance`, missing mock guard in `repurposeContent`, missing `trackApiCall` in both brainstorm functions.
6. **Agent-native hooks** — `getModel()` function + optional `modelOverride` parameter prepare for future autonomous model tier adjustment without over-engineering now.

### New Considerations Discovered
- **11th call site**: `scripts/lib/qa-audit/audit.ts:270` (dev tooling, not production — excluded from migration scope)
- **Test fragility**: `src/__tests__/lib/ai.test.ts:17` mocks Anthropic constructor by call order index; centralization may shift the index
- **Batch API incompatible**: Lambda crons have 5-min timeout; Batch API returns in 15-60 min — would need SQS/Step Functions bridge (not worth it at current volume)

---

## Overview

The entire AI pipeline (10 production call sites) hardcodes `claude-sonnet-4-6` with zero model abstraction, no cost tracking, and no ability to optimize model selection per task. This plan introduces a central model configuration module, downgrades one high-volume simple task to Haiku 4.5, and enables cost observability through token usage tracking.

**Projected impact:** ~10-15% cost reduction on `generatePostContent` (the only user-facing, latency-sensitive call suitable for Haiku) + full cost visibility across all AI functions for data-driven future optimization.

## Problem Statement / Motivation

1. **No model abstraction** — the string `"claude-sonnet-4-6"` appears as a literal in 10 separate files. Changing models requires find-and-replace across the codebase.
2. **Overspending on simple tasks** — `generatePostContent` (short text gen, 1024 max tokens, no structured output) runs on Sonnet when Haiku 4.5 would suffice at 3x lower cost with ~2x faster latency.
3. **No cost visibility** — only 1 of 10 call sites captures token usage. Two brainstorm functions lack `trackApiCall` entirely. Impossible to know per-function costs.
4. **Pre-existing gaps** — `analyzePerformance` uses unsafe `as` cast instead of Zod validation (inconsistent with all other AI functions); `repurposeContent` is missing the `shouldMockExternalApis()` guard present in every other call site.
5. **Level 5 readiness** — a Level 5 autonomous engineering system needs intelligent resource allocation. Hardcoded model selection is a Level 2 pattern.

## Proposed Solution

### Architecture

Create a minimal `src/lib/ai/models.ts` module that:
- Exports a lazy-initialized Anthropic client singleton (following `src/lib/db.ts` pattern)
- Exports two model constants: `MODEL_DEFAULT` (Sonnet) and `MODEL_FAST` (Haiku)
- Exports a `getModel()` function for future flexibility (agent-native hook)
- Keeps `max_tokens` per-call-site (varies from 1024 to 8192, appropriately)

```
src/lib/ai/
  models.ts           ← NEW: central model config + lazy client
  index.ts            ← UPDATE: import from models.ts, fix analyzePerformance Zod gap
  briefs.ts           ← UPDATE: import from models.ts
  research.ts         ← UPDATE: import from models.ts
  repurpose.ts        ← UPDATE: import from models.ts, add missing mock guard
  ...
```

### Research Insights — Architecture

> **Simplicity reviewer:** "The plan conflates 'centralize a string constant' (simple, high-value) with 'build cost observability infrastructure' (complex, low-value at your scale). Do the first."
>
> **Architecture strategist:** "Do not build an 'AI client' wrapper. The call sites diverge on max_tokens, tools, tool_choice, system prompts, and streaming vs non-streaming. A wrapper that accommodates all of these would replicate the SDK surface area."
>
> **Pattern recognition specialist:** "The codebase has a clear idiom for centralized configuration. `src/env.ts` validates env vars with Zod and exports a singleton. `src/lib/db.ts` exports a lazy-init Prisma client. `models.ts` should follow this pattern exactly."

### Proposed `models.ts`

```typescript
import Anthropic from "@anthropic-ai/sdk";

// Model constants — change in one place, affects all call sites
export const MODEL_DEFAULT = "claude-sonnet-4-6" as const;
export const MODEL_FAST = "claude-haiku-4-5-20251001" as const;

// Derived type for metadata tracking
export type ModelId = typeof MODEL_DEFAULT | typeof MODEL_FAST;

/**
 * Returns the model ID for a given use case.
 * Currently a simple lookup, but designed as a function so future
 * enhancements (per-business overrides, agent-driven tier selection)
 * can be added here without changing call sites.
 */
export function getModel(
  tier: "default" | "fast",
  _options?: { modelOverride?: ModelId }
): ModelId {
  if (_options?.modelOverride) return _options.modelOverride;
  return tier === "fast" ? MODEL_FAST : MODEL_DEFAULT;
}

// Lazy-initialized singleton — avoids coupling test imports to API key
let _client: Anthropic | null = null;
export function getAnthropicClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

// Output limits per model (defensive reference for future tier additions)
// Haiku 4.5: 64k output tokens, 200k context
// Sonnet 4.6: 64k output tokens, 1M context
// Opus 4.6: 128k output tokens, 1M context
```

### Research Insights — TypeScript Design

> **TypeScript reviewer:** "Narrow `modelId` to a literal union derived from the constants. `modelId: string` is too loose. Two separate token extraction functions for streaming vs non-streaming — `Anthropic.Message` and `Anthropic.MessageStream` have different shapes."
>
> **Architecture strategist:** "`AiCallMetadata` interface should be deferred until there is a consumer that needs it. The `trackApiCall` metadata field is `Json?` — inline the shape at each call site for now."

### Model Assignment

| Function | File | Model | Rationale |
|----------|------|-------|-----------|
| `generatePostContent` | `src/lib/ai/index.ts` | **MODEL_FAST** (Haiku) | Short text gen (1024 max tokens), no structured output, user-facing latency benefit |
| `repurposeContent` | `src/lib/ai/repurpose.ts` | MODEL_DEFAULT (Sonnet) | Multi-constraint forced tool_choice: platform rules + pillar mapping + tone — Haiku unreliable |
| `extractContentStrategy` | `src/lib/ai/index.ts` | MODEL_DEFAULT (Sonnet) | Structured extraction from freeform wizard input |
| `analyzePerformance` | `src/lib/ai/index.ts` | MODEL_DEFAULT (Sonnet) | Pattern recognition + nuanced performance insights |
| `generateVideoStoryboard` | `src/lib/ai/index.ts` | MODEL_DEFAULT (Sonnet) | Creative multi-part coherent planning |
| `generateBriefs` | `src/lib/ai/briefs.ts` | MODEL_DEFAULT (Sonnet) | Complex 7-day calendar planning across platforms |
| `synthesizeResearch` | `src/lib/ai/research.ts` | MODEL_DEFAULT (Sonnet) | Theme extraction from multiple sources |
| `generateBrainstorm` | `src/lib/brainstorm/generate.ts` | MODEL_DEFAULT (Sonnet) | Creative ideation from GitHub context |
| `iterateBrainstorm` | `src/lib/brainstorm/iterate.ts` | MODEL_DEFAULT (Sonnet) | Refining ideas from human feedback (runs N times per comment) |
| Feedback chat | `src/app/api/feedback/chat/route.ts` | MODEL_DEFAULT (Sonnet) | Real-time conversational streaming |

### Research Insights — Model Selection

> **Performance oracle:** "Haiku is right for `generatePostContent`, wrong for `repurposeContent`. The generate call is a simple single-platform task with a ~150-token prompt — Haiku handles this well and delivers a ~2x latency improvement users will feel. But `repurposeContent` embeds per-platform character limits, tone rules, format constraints, and content pillar mapping across multiple platforms simultaneously. Haiku's instruction-following on that level of multi-constraint structured output is unreliable."
>
> **Agent-native reviewer:** "Manual generation via `POST /api/ai/generate` would get Haiku while autonomous brief generation via `generateBriefs` stays on Sonnet — this asymmetry should be explicitly documented as intentional."

**Intentional asymmetry documented:** `generatePostContent` is user-initiated, short-form, single-platform text generation — well-suited for Haiku's speed advantage. `generateBriefs` produces a coordinated 7-day multi-platform calendar requiring strategic coherence — Sonnet's reasoning capability is necessary.

### Current Pricing Reference

| Model | Input/MTok | Output/MTok | Relative to Sonnet |
|-------|-----------|-------------|-------------------|
| Haiku 4.5 | $1 | $5 | 3x cheaper |
| Sonnet 4.6 | $3 | $15 | baseline |
| Opus 4.6 | $5 | $25 | 1.67x more expensive |

## Implementation — Single Phase

**Effort:** Small — mechanical refactor, one behavior change (`generatePostContent` → Haiku).

> **Architecture strategist:** "Phase 1 (centralize client + constant) is a zero-behavior-change refactor. Phase 2 (prompt caching with cache_control blocks) changes API payloads and token consumption. These MUST be separate PRs."
>
> **Simplicity reviewer:** "You can get the same practical outcome with about 30 lines of new code instead of 200-300."

This is a single-PR mechanical refactor. Prompt caching and cost dashboards are deferred to separate future work (see "Future Work" section).

### Step 1: Create `src/lib/ai/models.ts`

As shown in the code block above. Exports: `MODEL_DEFAULT`, `MODEL_FAST`, `ModelId`, `getModel()`, `getAnthropicClient()`.

### Step 2: Migrate all 10 call sites

For each call site:
1. Replace `new Anthropic()` with `getAnthropicClient()` import
2. Replace hardcoded `"claude-sonnet-4-6"` with `getModel("default")` or `getModel("fast")`
3. Extract token usage from `response.usage` and include in `trackApiCall` metadata:
   ```typescript
   // Non-streaming (9 call sites):
   metadata: {
     modelId: getModel("default"),
     inputTokens: response.usage.input_tokens,
     outputTokens: response.usage.output_tokens,
   }

   // Streaming (feedback chat):
   const finalMessage = await stream.finalMessage();
   metadata: {
     modelId: getModel("default"),
     inputTokens: finalMessage.usage.input_tokens,
     outputTokens: finalMessage.usage.output_tokens,
   }
   ```

### Step 3: Fix pre-existing gaps (opportunistic)

These are bugs found during review — fix them while touching the files:

1. **`generateBrainstorm` + `iterateBrainstorm`**: Add `trackApiCall` wrapper (currently completely missing — zero observability on brainstorm AI calls)
2. **`analyzePerformance`** (`src/lib/ai/index.ts:381`): Replace unsafe `as` cast with Zod validation, consistent with all other AI functions
3. **`repurposeContent`** (`src/lib/ai/repurpose.ts`): Add missing `shouldMockExternalApis()` guard — it's the only AI function without one

### Step 4: Downgrade `generatePostContent` to Haiku

Change `getModel("default")` → `getModel("fast")` for this one function only.

### Step 5: Update tests

> **Architecture strategist:** "Tests at `src/__tests__/lib/ai.test.ts:17` reach into `mock.results[0].value` based on constructor call order. When the client moves to `models.ts`, the import graph changes and the mock results index could shift."
>
> **TypeScript reviewer:** "Migrate in two passes (2-3 simple call sites first, then the rest) rather than one PR touching all 10 files."

- Refactor test mocks to mock `@/lib/ai/models` directly instead of intercepting SDK constructor
- Update any assertions that reference model strings
- Add unit tests for `models.ts` exports
- Verify `shouldMockExternalApis()` pattern works with `getAnthropicClient()`

### Step 6: Validate Haiku quality for `generatePostContent`

Run 5-10 representative post generation inputs through both Sonnet and Haiku. Compare:
- Output quality and tone
- Adherence to platform character limits
- Hook/content pillar relevance

This is low-risk given the function's simplicity (short text, no structured output, single platform), but validate before merging.

## Acceptance Criteria

- [ ] `src/lib/ai/models.ts` exists with `MODEL_DEFAULT`, `MODEL_FAST`, `getModel()`, `getAnthropicClient()`
- [ ] Zero hardcoded `"claude-sonnet-4-6"` strings remaining in `src/` (grep verification)
- [ ] Zero `new Anthropic()` calls remaining in `src/` (all use `getAnthropicClient()`)
- [ ] `generatePostContent` uses `MODEL_FAST` (Haiku 4.5)
- [ ] All other 9 call sites use `MODEL_DEFAULT` (Sonnet 4.6)
- [ ] All 10 call sites include `inputTokens`, `outputTokens`, `modelId` in `trackApiCall` metadata
- [ ] `generateBrainstorm` and `iterateBrainstorm` have `trackApiCall` instrumentation
- [ ] `analyzePerformance` uses Zod validation instead of `as` cast
- [ ] `repurposeContent` has `shouldMockExternalApis()` guard
- [ ] All existing tests pass; new tests cover model config module
- [ ] `npm run ci:check` passes

## Technical Considerations

### Streaming vs Non-Streaming Token Extraction

> **TypeScript reviewer:** "Two separate typed functions beat one generic function with runtime branching."

The feedback chat route uses `client.messages.stream()` and extracts tokens via `stream.finalMessage()`. The other 9 call sites use `client.messages.create()` and get tokens from `response.usage` directly. Keep these as two inline patterns — no shared utility needed for two shapes.

### Mock Compatibility

> **Pattern recognition specialist:** "The mock check short-circuits before the client is reached. A centralized client singleton has zero impact on mock behavior. `trackApiCall` also independently checks `shouldMockExternalApis()` and skips the DB write."

The `getAnthropicClient()` lazy init means the client is never constructed during mock runs (the early return happens first). No changes needed to mock infrastructure.

### Error Handling

No fallback routing (try Haiku, fall back to Sonnet). Rationale from performance review:
- Adds complexity and double-billing risk
- Model outages are rare and transient
- Cron jobs retry on next schedule naturally
- Lambda cold starts are unaffected — Anthropic client is stateless

### `iterateBrainstorm` Loop Cost

> **Agent-native reviewer:** "`iterateBrainstorm` calls Claude once per human comment in a sequential loop. If a brainstorm issue accumulates 5 comments, that is 5 sequential Claude calls."

With `trackApiCall` instrumentation added, each loop iteration will be individually tracked. No cap needed at current volume (2-person team), but the data will surface if costs grow.

## System-Wide Impact

### Interaction Graph

`models.ts` exports → all 10 AI call sites → `trackApiCall()` metadata gains token fields → `ApiCall` table (no schema change, metadata is `Json?`)

No callbacks, middleware, or observers affected. Pure SDK call-layer change.

### Error Propagation

Errors from Anthropic API propagate unchanged. Each call site already has try/catch + `trackApiCall` error recording. The only new error path: `getAnthropicClient()` fails to construct (missing API key) — same failure as today, just centralized.

### State Lifecycle Risks

None. Model selection is stateless — reads from constants, not from database or cache.

### API Surface Parity

No API route request/response contracts change. Model selection is an internal implementation detail.

## Success Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Hardcoded model strings | 10 | 0 | `grep -r "claude-sonnet-4-6" src/` |
| Call sites with token tracking | 1/10 | 10/10 | Query `ApiCall` for non-null token metadata |
| `generatePostContent` latency | ~1.5s (Sonnet) | ~0.7s (Haiku) | `trackApiCall` latency on endpoint `generatePostContent` |
| Model config files to update on release | 10 | 1 | Count of files referencing model IDs |

## Dependencies & Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Haiku quality insufficient for `generatePostContent` | Low | Low | Validate with 5-10 samples; revert to Sonnet is a one-line change |
| Test mock fragility from centralized client | Medium | Low | Refactor tests to mock `@/lib/ai/models` directly |
| New Anthropic model release changes IDs | Certain (eventually) | Low | Single-file update in `models.ts` — that's the whole point |
| Token extraction differs streaming vs non-streaming | Low | Low | Two inline patterns, both well-documented |

## Future Work (Separate PRs)

### Prompt Caching (Deprioritized)

> **Performance oracle:** "The 5-minute prompt cache is wasted on every background cron. Research runs every 4 hours, briefs weekly, optimization weekly. The cache expires long before the next invocation."

Prompt caching only provides value within a single batch operation (e.g., fulfillment processing multiple briefs for the same business in sequence). This is a narrow win at current scale. Revisit when:
- Fulfillment processes 5+ briefs per business per run, OR
- A new high-frequency AI feature is added that reuses strategy context within 5 minutes

### Agent-Native Model Selection (Level 5 Enhancement)

> **Agent-native reviewer:** "The weekly optimizer can detect that posts are declining but cannot correlate this with a model downgrade or recommend a correction."
>
> **Agent-native architecture skill:** "Make model access a function (`getModel(tier, context?)`) instead of a bare constant. Wrapping in a function means adding per-business overrides later is a config change in one place, not a refactor of 10 call sites."

The `getModel()` function and `modelOverride` parameter are scaffolded in this plan. Future work to close the loop:
1. Add `preferredModelTier` field to `ContentStrategy` Prisma model
2. Extend the optimizer's `update_strategy` tool schema with `modelTierRecommendations`
3. Wire cost data from `trackApiCall` into the optimizer's input context
4. The optimizer can then recommend tier adjustments based on cost-quality correlation

### Cost Observability Dashboard

With token usage tracked on every `ApiCall` record after this work, future work can build:
- Cost-per-function breakdown
- Cost anomaly alerts
- Model tier A/B comparison dashboards

At current scale (2-person team, ~50-100 AI calls/week), the Anthropic billing console suffices.

## Alternative Approaches Considered

### 3-Tier Model Map (fast/standard/powerful)
**Simplified.** The original plan proposed 3 tiers with Opus as "powerful." No call site uses Opus today. Two constants (`MODEL_DEFAULT`, `MODEL_FAST`) achieve the same result with less abstraction. Add Opus when the first consumer exists.

### Vercel AI SDK Migration
**Rejected.** Single-provider setup. Reconsider if a second LLM provider is added.

### RouteLLM / Automatic Difficulty Classification
**Rejected.** Tasks are already categorized by function name — we know complexity at call time.

### LiteLLM / Portkey Gateway
**Rejected.** Solve multi-provider routing. We use one provider.

### Per-Business Model Overrides (Database)
**Deferred.** The `getModel()` function scaffolds this for later without requiring schema changes now.

### Environment Variable Model Selection
**Rejected.** Model changes are infrequent and should be code-reviewed.

### Downgrading `repurposeContent` to Haiku
**Rejected after review.** Multi-constraint structured output (forced tool_choice + platform-specific rules + pillar mapping + tone classification) requires Sonnet's instruction-following capability. Haiku's quality on this level of structured generation is unreliable.

## Sources & References

### Internal References
- `src/lib/ai/index.ts:15` — Anthropic client singleton, 4 AI functions
- `src/lib/ai/index.ts:381` — `analyzePerformance` unsafe `as` cast (fix target)
- `src/lib/ai/briefs.ts:7,116` — brief generation client + call
- `src/lib/ai/research.ts:7,85` — research synthesis client + call
- `src/lib/ai/repurpose.ts:7,179` — repurposing client + call (missing mock guard)
- `src/lib/brainstorm/generate.ts:16,104` — brainstorm generation (missing trackApiCall)
- `src/lib/brainstorm/iterate.ts:21,125` — brainstorm iteration (missing trackApiCall, runs in loop)
- `src/app/api/feedback/chat/route.ts:101,109` — per-request client + streaming call (only site with token tracking)
- `src/lib/system-metrics.ts:13-21` — `trackApiCall()` signature
- `src/lib/db.ts` — lazy-init singleton pattern to follow
- `src/env.ts` — centralized config pattern to follow
- `src/__tests__/lib/ai.test.ts:17` — fragile mock that needs refactoring
- `scripts/lib/qa-audit/audit.ts:270` — 11th hardcoded model string (dev tooling, out of scope)

### External References
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview) — official model lineup and recommendations
- [Anthropic Pricing](https://platform.claude.com/docs/en/about-claude/pricing) — pricing including caching and batch discounts
- [Anthropic Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — cache_control API reference
- [RouteLLM](https://github.com/lm-sys/RouteLLM) — automatic LLM routing framework (evaluated, not adopted)

### Review Agents Consulted
- **Kieran TypeScript Reviewer** — type safety, lazy init, literal union types
- **Performance Oracle** — Haiku suitability, cache TTL analysis, Batch API incompatibility
- **Security Sentinel** — low risk overall, `analyzePerformance` Zod gap
- **Architecture Strategist** — premature abstraction, separate PRs, no wrapper
- **Code Simplicity Reviewer** — cut 3-tier map, cut token tracking types, keep minimal
- **Agent-Native Reviewer** — runtime overrides, optimizer feedback loop, 11th call site
- **Pattern Recognition Specialist** — consistent patterns, mock compatibility, brainstorm gaps
- **Agent-Native Architecture Skill** — `getModel()` function pattern, defer dynamic routing
- **Best Practices Researcher** — Anthropic SDK prompt caching mechanics
