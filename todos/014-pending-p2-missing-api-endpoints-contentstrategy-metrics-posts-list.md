---
status: complete
priority: p2
issue_id: "014"
tags: [code-review, agent-native, api, architecture]
dependencies: []
---

# P2 — Missing API Endpoints: ContentStrategy Read/Update, Metrics, Business-Scoped Posts List

## Problem Statement

Three API surface gaps will block both UI functionality and future agent operation:

1. **`GET /PATCH /api/businesses/[id]/strategy`** — the plan has a `/strategy` page but no API endpoint. ContentStrategy is inaccessible to agents and the page has no data source.
2. **`GET /api/businesses/[id]/metrics`** (or business-scoped posts with metrics) — metrics are stored in Post fields but have no queryable endpoint. M2's autonomous optimization loop has no feedback mechanism.
3. **`GET /api/posts` is not updated for business-scoped listing** — the plan removes `Post.userId` but doesn't explicitly update the existing `GET /api/posts` endpoint. Without `userId`, the current query returns nothing (or all posts).

## Findings

- Source: agent-native-reviewer (Findings 1, 3, 7)
- 14 of 21 user-facing capabilities are agent-accessible as planned; these three gaps reduce it further
- The strategy page at `/dashboard/[businessId]/strategy/` is listed as a new file but has no corresponding API route — it cannot load data
- `GET /api/posts` currently scopes by `where: { userId: session.user.id }` — `userId` is removed from Post in Phase 1

## Proposed Solutions

### Fix 1 — Add `GET` and `PATCH` for ContentStrategy
New routes in Phase 6:

- `GET /api/businesses/[id]/strategy` → membership check → return ContentStrategy or 404
- `PATCH /api/businesses/[id]/strategy` → owner-only → validate with `ContentStrategyInputSchema` → upsert

```typescript
// PATCH /api/businesses/[id]/strategy
const body = ContentStrategyInputSchema.partial().safeParse(await req.json());
if (!body.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

await prisma.contentStrategy.update({
  where: { businessId: params.id },
  data: body.data,
});
```

### Fix 2 — Business-scoped posts with metrics
Extend `GET /api/businesses/[id]/posts` to accept `?include=metrics` or return metrics fields by default. Alternatively add `GET /api/businesses/[id]/metrics` returning aggregated and per-post metrics filtered by date range.

### Fix 3 — Update `GET /api/posts` for business-scoped listing
Either:
- Migrate `GET /api/posts` to `GET /api/businesses/[id]/posts` (cleaner — consistent with URL routing)
- OR add `?businessId=` query param to `GET /api/posts` and update the query

The plan must declare the canonical endpoint before Phase 9 implementation.

**Effort:** Medium total | **Risk:** Low

## Recommended Action

Add all three to Phase 6 API routes list. Add test files for each. Decide now: `GET /api/businesses/[id]/posts` vs `GET /api/posts?businessId=`.

## Technical Details

- **Affected files:** `src/app/api/businesses/[id]/strategy/route.ts` (new), `src/app/api/businesses/[id]/posts/route.ts` (new or updated), `src/app/api/posts/route.ts` (updated)
- **Plan phases:** Phase 6, Phase 9

## Acceptance Criteria

- [ ] `GET /api/businesses/[id]/strategy` returns ContentStrategy (or 404 if none)
- [ ] `PATCH /api/businesses/[id]/strategy` validates with `ContentStrategyInputSchema.partial()` — owner only
- [ ] Business-scoped post listing endpoint declared and implemented
- [ ] `GET /api/posts` updated or redirected so it works after `Post.userId` removal
- [ ] `GET /api/businesses/[id]/strategy` listed in New Files and has a test

## Work Log

- 2026-03-07: Identified by agent-native-reviewer (Findings 1, 3, 7) during plan review
