---
status: complete
priority: p1
issue_id: "036"
tags: [code-review, security, race-condition, fulfillment-engine]
dependencies: []
---

# Approve Route Race Condition — Missing Atomic Status Guard

## Problem Statement

The `POST /api/posts/[id]/approve` endpoint uses a read-then-write pattern (`findFirst` then `update`) without a status guard on the write. Between the read and write, the auto-approval cron or another request could change the post status. The `update` at line 41 uses `where: { id }` without checking `status: "PENDING_REVIEW"`, meaning it could overwrite a post that was already rejected (DRAFT) or otherwise transitioned.

**Flagged by:** kieran-typescript-reviewer, security-sentinel, performance-oracle (3 independent agents)

## Findings

- `src/app/api/posts/[id]/approve/route.ts` lines 18-47: `findFirst` checks status, but `update` on line 41 uses only `where: { id }` — no status guard
- The reject endpoint at `src/app/api/posts/[id]/reject/route.ts` correctly uses `updateMany` with `where: { id, status: "PENDING_REVIEW" }` — inconsistent patterns
- The scheduler's `autoApproveExpiredReviews()` runs every minute and could race with manual approval

## Proposed Solutions

### Option A: Use updateMany with status guard (Recommended)
Replace `prisma.post.update` with `prisma.post.updateMany` using a status guard:
```typescript
const result = await prisma.post.updateMany({
  where: { id, status: "PENDING_REVIEW" },
  data: { status: "SCHEDULED", reviewWindowExpiresAt: null },
});
if (result.count === 0) {
  const current = await prisma.post.findUnique({ where: { id } });
  if (current?.status === "SCHEDULED") {
    return NextResponse.json({ ...current, alreadyApproved: true });
  }
  return NextResponse.json({ error: "Post is no longer in review" }, { status: 409 });
}
```
- Pros: Atomic, matches reject endpoint pattern, minimal change
- Cons: Requires extra query to return full post object
- Effort: Small
- Risk: Low

## Recommended Action

Option A

## Technical Details

- **Affected files:** `src/app/api/posts/[id]/approve/route.ts`
- **Related patterns:** Reject endpoint, scheduler `autoApproveExpiredReviews()`

## Acceptance Criteria

- [ ] Approve endpoint uses `updateMany` with `status: "PENDING_REVIEW"` in where clause
- [ ] Returns 409 if post already transitioned away from PENDING_REVIEW
- [ ] Existing approve tests still pass
- [ ] Pattern matches reject endpoint

## Work Log

- 2026-03-08: Created from code review of feat/ai-fulfillment-engine

## Resources

- PR: feat/ai-fulfillment-engine branch
