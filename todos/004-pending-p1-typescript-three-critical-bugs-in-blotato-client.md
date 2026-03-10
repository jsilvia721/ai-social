---
status: complete
priority: p1
issue_id: "004"
tags: [code-review, typescript, blotato, bugs]
dependencies: []
---

# P1 — Three Critical TypeScript Bugs in Plan's Blotato Client Code

## Problem Statement

Three bugs in the plan's code patterns will survive TypeScript compilation but fail silently or produce wrong behavior at runtime:

1. `blotatoFetch<T>` uses `z.ZodType<T>` — caller-controlled type annotation overrides schema inference, allowing type mismatch to pass `tsc`
2. `Object.setPrototypeOf` missing in `BlotatoApiError`/`BlotatoRateLimitError` — `instanceof` always returns `false` in Lambda (Node.js/TypeScript compiled to CommonJS), breaking `shouldRetry()`
3. `shouldRetry` receives `post.retryCount` (old count) instead of `newRetryCount` (incremented) — posts get 4 attempts instead of 3; SES alert fires on the 4th failure, not the 3rd

## Findings

- Source: kieran-typescript-reviewer (Findings 1, 2, 3 — all Severity 1)
- Bug #2 is a well-documented TypeScript + Node.js pitfall: subclasses of built-in `Error` have broken `instanceof` when compiled to ES5/CommonJS unless `Object.setPrototypeOf` is called in the constructor
- Bug #3: when `post.retryCount === 2` (third attempt), `shouldRetry(err, 2)` returns `true`, post is set to RETRYING with `retryCount = 3`. Next invocation picks it up, fails, `shouldRetry(err, 3)` returns `false`. Four total attempts, not three.

## Proposed Solutions

### Fix #1 — Correct `blotatoFetch` generic
```typescript
// WRONG (plan's version):
export async function blotatoFetch<T>(path: string, schema: z.ZodType<T>, ...): Promise<T>

// CORRECT:
export async function blotatoFetch<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  options: RequestInit = {},
): Promise<z.infer<S>>
```
Schema drives the type; no caller type annotation needed.

### Fix #2 — Add `Object.setPrototypeOf` to both error classes
```typescript
export class BlotatoApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BlotatoApiError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BlotatoRateLimitError extends BlotatoApiError {
  constructor(public readonly retryAfterMs: number) {
    super("Rate limited by Blotato", 429);
    this.name = "BlotatoRateLimitError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

### Fix #3 — Pass incremented count to `shouldRetry`
```typescript
// WRONG (plan):
const retryCount = post.retryCount + 1;
if (shouldRetry(err, post.retryCount)) { ... }

// CORRECT:
const newRetryCount = post.retryCount + 1;
if (shouldRetry(err, newRetryCount)) {
  await prisma.post.update({ data: { retryCount: newRetryCount, ... } });
} else {
  // newRetryCount === 3 — send SES alert
}
```

**Effort for all three:** Small | **Risk:** Low

## Recommended Action

Apply all three fixes before writing any implementation code — they are design patterns that will propagate into many files.

## Technical Details

- **Affected files:** `src/lib/blotato/client.ts`, `src/lib/scheduler.ts`
- **Plan phases:** Phase 2, Phase 8

## Acceptance Criteria

- [ ] `blotatoFetch` uses `z.ZodTypeAny` + `z.infer<S>` — no caller type annotation needed
- [ ] Both error classes call `Object.setPrototypeOf(this, new.target.prototype)` in constructor
- [ ] `shouldRetry(err, newRetryCount)` called with incremented count
- [ ] `Object.setPrototypeOf` fix verified with a test: `new BlotatoRateLimitError(1000) instanceof BlotatoRateLimitError` returns `true`
- [ ] Scheduler test: post with `retryCount = 2` results in `retryCount = 3` (FAILED), not `retryCount = 3` (RETRYING)

## Work Log

- 2026-03-07: Identified by kieran-typescript-reviewer (all Severity 1) during plan review
