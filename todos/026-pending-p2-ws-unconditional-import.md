---
status: complete
priority: p2
issue_id: "026"
tags: [code-review, performance, lambda, cold-start]
dependencies: []
---

# `ws` WebSocket library imported unconditionally — adds cold start overhead for pg paths

## Problem Statement

`src/lib/db.ts` imports `ws` at the top level regardless of which database adapter is used. When the connection string does not contain `neon.tech` (local Docker, CI Postgres), the `ws` module is loaded but never used. `ws` is a non-trivial dependency; loading it unnecessarily adds a small amount to Lambda cold start time and bundle size.

## Findings

- **File:** `src/lib/db.ts:6` — `import ws from "ws"` at module top level
- `ws` is only needed in the `if (connectionString.includes("neon.tech"))` branch
- In production (Neon), this is fine — `ws` is used
- In CI/local (pg pool), `ws` is loaded and immediately discarded
- Bundle impact: `ws` adds ~80KB to the Lambda bundle
- Confirmed by: Code Simplicity Reviewer

## Proposed Solutions

### Option A: Dynamic import of ws inside the Neon branch (Recommended)
```typescript
if (connectionString.includes("neon.tech")) {
  const { default: ws } = await import("ws");
  neonConfig.webSocketConstructor = ws;
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter, log });
}
```
- Pros: `ws` only loaded when Neon path is taken
- Cons: `createPrismaClient` becomes async (requires callers to await)
- Effort: Small | Risk: Low

### Option B: Lazy require
```typescript
if (connectionString.includes("neon.tech")) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  neonConfig.webSocketConstructor = require("ws");
  ...
}
```
- Pros: No async change; `ws` only loaded on Neon path
- Cons: Uses `require()` in ESM context (may need CJS interop config)
- Effort: Tiny | Risk: Low

### Option C: Accept unconditional import
- Production always uses Neon → `ws` is always needed → unconditional import is correct for prod
- Local/CI uses pg → `ws` is dead weight but doesn't cause errors
- Bundle size difference (~80KB) is negligible at Lambda scale
- Pros: Zero change; simpler code
- Effort: None | Risk: None

## Recommended Action

Option C for now — the overhead is negligible and production always needs `ws`. This is a P2 cleanup, not a blocker.

## Technical Details

- **Affected files:** `src/lib/db.ts`

## Acceptance Criteria

- [ ] Either: `ws` import is lazy (inside Neon branch) OR a comment justifies the unconditional import

## Work Log

- 2026-03-06: Identified by Code Simplicity Reviewer during AWS migration PR review.

## Resources

- PR #2: feat/aws-sst-migration
