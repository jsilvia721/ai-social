---
status: pending
priority: p3
issue_id: "018"
tags: [code-review, yagni, simplicity, typescript]
dependencies: []
---

# P3 — Simplify: Cut `BusinessProvider`, Inline `types.ts`, Collapse Error Subclass

## Problem Statement

Three over-engineering issues in the plan's proposed file structure:

1. **`BusinessProvider.tsx` and `useBusiness()`** — the plan itself notes "`useParams()` is sufficient for simple components." `BusinessProvider` exists only to expose `businessName` to the Sidebar — this can be a prop from the layout server component. Adding a context provider creates an extra client boundary that pushes more tree client-side.

2. **Separate `src/lib/blotato/types.ts`** — at M1 scale (3-4 interfaces), a dedicated types file is premature indirection. Types should live in the files that use them (`client.ts`, `accounts.ts`, `publish.ts`).

3. **`BlotatoRateLimitError` subclass** — `shouldRetry()` checks `err.status !== 429`, not `instanceof BlotatoRateLimitError`. The subclass's only unique value is `retryAfterMs`. This can be an optional field on `BlotatoApiError`:
```typescript
export class BlotatoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs?: number,
  ) { ... }
}
```

## Findings

- Source: code-simplicity-reviewer (Findings 9, 10, 12), architecture-strategist (Finding 9), kieran-typescript-reviewer (Finding 12)
- 3 files removable: `BusinessProvider.tsx`, `types.ts`, and `BlotatoRateLimitError` class (inline into `BlotatoApiError`)
- The `ssrf-guard.ts` standalone file is also a simplification opportunity — inline into `publish.ts` where it's called (consistent with the plan's rationale for inlining SES in scheduler)

## Proposed Solutions

### Cut `BusinessProvider.tsx`
```typescript
// Layout server component passes businessName as prop:
const { business } = await requireBusinessMember(params.businessId, session.user.id);
return (
  <>
    <Sidebar businessId={params.businessId} businessName={business.name} />
    {children}
  </>
);
```
Client components use `useParams<{ businessId: string }>()` for `businessId`. No context needed.

### Inline `types.ts`
Move `BlotatoAccount`, `BlotatoPublishResult` into the files that use them.

### Collapse `BlotatoRateLimitError`
```typescript
export class BlotatoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfterMs?: number, // set on 429 responses
  ) {
    super(message);
    this.name = "BlotatoApiError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
```

**Net: 3-4 files removed from the new files list.**

## Recommended Action

Apply during Phase 2 implementation. Update the new files list in the plan.

## Technical Details

- **Affected files:** `src/components/providers/BusinessProvider.tsx` (remove), `src/lib/blotato/types.ts` (remove), `src/lib/blotato/client.ts` (simplify error class), `src/lib/blotato/ssrf-guard.ts` (inline)
- **Plan phases:** Phase 2, Phase 6

## Acceptance Criteria

- [ ] `BusinessProvider.tsx` removed; `businessName` passed as prop from layout
- [ ] `types.ts` removed; types inlined into consuming files
- [ ] `BlotatoRateLimitError` class removed; `retryAfterMs?: number` field added to `BlotatoApiError`
- [ ] `ssrf-guard.ts` removed; guard inlined into `publish.ts`
- [ ] Net file count: 27 new files instead of 31

## Work Log

- 2026-03-07: Identified by code-simplicity-reviewer, architecture-strategist, kieran-typescript-reviewer during plan review
