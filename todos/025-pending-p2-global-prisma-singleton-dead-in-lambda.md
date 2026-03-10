---
status: complete
priority: p2
issue_id: "025"
tags: [code-review, architecture, lambda, prisma]
dependencies: []
---

# globalForPrisma singleton pattern is a no-op in Lambda cold starts

## Problem Statement

`src/lib/db.ts` uses the `globalForPrisma` pattern (storing `prisma` on `globalThis`) to prevent multiple Prisma client instances during Next.js hot-reload in development. In Lambda (production), each cold start creates a fresh Node.js process — `globalThis` is always empty. The singleton pattern provides zero benefit in Lambda and adds confusion about why it's there.

The code is not harmful, but it's misleading and adds noise that future developers will need to understand and reason about.

## Findings

- **File:** `src/lib/db.ts:8,34,36` — `globalForPrisma` pattern
- In Lambda: every cold start = new process = `globalForPrisma.prisma` always undefined → `createPrismaClient()` always called
- The `if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma` guard means it only caches in dev anyway
- The entire pattern exists solely for Next.js dev hot-reload; irrelevant in Lambda
- Confirmed by: Code Simplicity Reviewer

## Proposed Solutions

### Option A: Keep as-is — it's harmless and helps local dev
- The pattern only activates in development (`NODE_ENV !== "production"`)
- In Lambda (`NODE_ENV === "production"`), the guard prevents the cache from ever being set
- Local dev benefits: no "PrismaClient already 10 instances" warning during hot-reload
- Pros: Works correctly in both environments; no change needed
- Cons: Code appears to do something in Lambda that it doesn't
- Effort: None | Risk: None

### Option B: Add a comment explaining the pattern
- Add a one-line comment: `// Prevents multiple instances during Next.js hot-reload in dev; no-op in Lambda`
- Pros: Eliminates confusion; zero code change
- Effort: Tiny | Risk: None

### Option C: Remove the pattern (simplify for Lambda-only context)
- Since the app now runs in Lambda, remove `globalForPrisma` and always call `createPrismaClient()`
- Add a `// Note: Each Lambda cold start creates a new client` comment
- Pros: Simpler code; honest about Lambda lifecycle
- Cons: Local dev will create a new Prisma client on every hot-reload (not harmful, just noisy)
- Effort: Small | Risk: None

## Recommended Action

Option B — add a comment. The pattern is harmless and actually helps local development.

## Technical Details

- **Affected files:** `src/lib/db.ts`

## Acceptance Criteria

- [ ] Either: comment added explaining the pattern, OR globalForPrisma removed
- [ ] Local dev: no "Too many Prisma clients" warning
- [ ] Lambda: continues to create a fresh client per cold start (correct behavior)

## Work Log

- 2026-03-06: Identified by Code Simplicity Reviewer during AWS migration PR review. Low urgency — add comment.

## Resources

- PR #2: feat/aws-sst-migration
