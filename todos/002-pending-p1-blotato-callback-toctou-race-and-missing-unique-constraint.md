---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, security, database, race-condition]
dependencies: []
---

# P1 — Blotato Callback TOCTOU Race + Missing `@@unique([blotatoAccountId])`

## Problem Statement

The Blotato OAuth callback does a `findFirst` pre-check to detect cross-business account conflicts, then a separate `upsert`. Between these two operations, a concurrent request can create a duplicate `blotatoAccountId` on a different business, causing two workspaces to believe they own the same Blotato account. This leads to cross-business publishing — posts from Business A sent to Business B's social account.

The fix is atomic: add `@@unique([blotatoAccountId])` to `SocialAccount`. The database enforces uniqueness instead of the racy application-level check.

## Findings

- Source: security-sentinel (P1-1), performance-oracle (Finding 9)
- The `upsert` keys on `platform_platformId`, not `blotatoAccountId` — a second concurrent callback with the same Blotato account ID can succeed
- `blotatoAccountId` has no unique constraint or index in the plan's schema
- The `findFirst` pre-check is a UX fast-path, not a correctness guard
- Without `@@unique([blotatoAccountId])`, `findFirst({ where: { blotatoAccountId } })` is a sequential scan

## Proposed Solutions

### Option A — Add `@@unique([blotatoAccountId])` to schema (Recommended)
```prisma
model SocialAccount {
  blotatoAccountId String @unique
  // ...
}
```

The upsert will throw a unique constraint violation on duplicate — handle as a 409 redirect:
```typescript
try {
  await prisma.socialAccount.upsert({ ... });
} catch (e) {
  if (isPrismaUniqueViolation(e)) {
    return NextResponse.redirect(new URL("/dashboard/accounts?error=account_claimed", req.url));
  }
  throw e;
}
```

The `findFirst` pre-check can remain as a UX fast-path but is no longer load-bearing for correctness.

**Pros:** Atomic enforcement at DB level. Race condition eliminated.
**Cons:** Requires migration (part of Phase 1 anyway).
**Effort:** Small | **Risk:** Low

### Option B — Wrap findFirst + upsert in a Postgres advisory lock
Acquire an advisory lock keyed on `blotatoAccountId` hash before the check+write pair.

**Pros:** No schema change needed.
**Cons:** Neon serverless HTTP adapter doesn't support advisory locks well. More complex.
**Effort:** Medium | **Risk:** Medium

## Recommended Action

Option A — include in Phase 1 migration. One line change to schema.

## Technical Details

- **Affected files:** `prisma/schema.prisma`, `src/app/api/connect/blotato/callback/route.ts`
- **Plan phase:** Phase 1 (schema) + Phase 4 (callback)

## Acceptance Criteria

- [ ] `@@unique([blotatoAccountId])` added to `SocialAccount` in migration
- [ ] Callback handler catches unique constraint violation and redirects with `?error=account_claimed`
- [ ] `findFirst` pre-check retained as UX fast-path but not relied on for correctness
- [ ] Test: concurrent callback requests for same `blotatoAccountId` result in exactly one `SocialAccount` row

## Work Log

- 2026-03-07: Identified by security-sentinel (P1-1) and performance-oracle (Finding 9) during plan review
