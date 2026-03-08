---
status: pending
priority: p2
issue_id: "012"
tags: [code-review, security, architecture, scheduler]
dependencies: []
---

# P2 — Approve Path Sets `PUBLISHING` and Publishes Synchronously — Should Set `SCHEDULED`

## Problem Statement

The plan's `PATCH /api/posts/[id]` approve path atomically claims the post by setting `status = PUBLISHING`, then synchronously calls Blotato to publish within the HTTP request handler. If Blotato takes >10-30 seconds (Lambda timeout), the client receives a timeout while the server may still be mid-publish. On retry, the client gets a 409 (post is already `PUBLISHING`), creating a confusing UX where the user doesn't know if approval succeeded.

Additionally, a failed Blotato call in the approve path has no retry machinery — it goes directly to `FAILED` without the backoff that the scheduler provides. This creates inconsistent retry behavior: scheduler-triggered publishes retry; user-approved publishes do not.

## Findings

- Source: security-sentinel (P2-5), architecture-strategist (Finding 8)
- The plan's own scheduler is designed to be the single publishing authority
- The `PUBLISHING` lock should only be set by the scheduler, not by the approve route
- Architecture review: synchronous publish in an HTTP route also means a Lambda cold-start can add 500ms-2s latency to what should be an instant UI action

## Proposed Solutions

### Option A — Approve sets `SCHEDULED` with `scheduledAt = now` (Recommended)
```typescript
const result = await prisma.post.updateMany({
  where: {
    id: params.id,
    status: "PENDING_REVIEW",
    business: { members: { some: { userId: session.user.id } } },
  },
  data: {
    status: body.action === "approve" ? "SCHEDULED" : "DRAFT",
    scheduledAt: body.action === "approve" ? new Date() : undefined,
    reviewWindowExpiresAt: null,  // clear the window
  },
});
if (result.count === 0) return NextResponse.json({ error: "Not found or already processed" }, { status: 409 });
return NextResponse.json({ status: "ok" });
```

The scheduler picks it up within 60 seconds. Publishing follows the full retry path.

**Pros:** Keeps publishing in one place (scheduler). Retry machinery applies. No timeout risk. Simpler route code.
**Cons:** 0-60 second delay between approval and publish. Acceptable for the use case.
**Effort:** Small | **Risk:** Low

### Option B — Keep synchronous publish but add full error recovery
Add proper timeout guard, retry enqueue on failure, and client-side polling.

**Pros:** Immediate publish UX.
**Cons:** Complex. Publishing logic in two places (scheduler + approve route). Timeout still possible.
**Effort:** Large | **Risk:** Medium

## Recommended Action

Option A. Publishing belongs in the scheduler. The 60-second delay is not a meaningful UX regression for a review-window workflow.

## Technical Details

- **Affected files:** `src/app/api/posts/[id]/route.ts`
- **Plan phase:** Phase 10

## Acceptance Criteria

- [ ] Approve path sets `status = "SCHEDULED"` with `scheduledAt = now()` — does NOT set `PUBLISHING`
- [ ] Reject path sets `status = "DRAFT"`
- [ ] Scheduler picks up the approved post within the next tick
- [ ] Test: approve → post transitions to SCHEDULED; within 1 minute → PUBLISHED

## Work Log

- 2026-03-07: Identified by security-sentinel (P2-5) and architecture-strategist (Finding 8) during plan review
