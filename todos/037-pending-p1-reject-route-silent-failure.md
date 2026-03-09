---
status: complete
priority: p1
issue_id: "037"
tags: [code-review, data-integrity, fulfillment-engine]
dependencies: []
---

# Reject Route Silent Failure — updateMany Count Not Checked

## Problem Statement

The reject endpoint uses `updateMany` with a status guard (good), but then does a separate `findUnique` to return the updated post without checking whether `updateMany` matched any rows. If the post was already transitioned (e.g., auto-approved to SCHEDULED), the `updateMany` matches zero rows, the `findUnique` returns the current state, and the client receives a 200 response as if rejection succeeded.

## Findings

- `src/app/api/posts/[id]/reject/route.ts` lines 42-58: batch transaction with `updateMany`, then separate `findUnique`
- If `updateMany` matches 0 rows (post already transitioned), the brief `updateMany` also correctly does nothing (status guard on FULFILLED)
- But the response is still 200 with the current post state — client thinks rejection succeeded

## Proposed Solutions

### Option A: Check updateMany result count (Recommended)
After the transaction, check if the post update matched:
```typescript
const [postResult] = await prisma.$transaction([...]);
if (postResult.count === 0) {
  return NextResponse.json({ error: "Post is no longer in review" }, { status: 409 });
}
```
- Pros: Consistent with approve endpoint fix, clear error to client
- Cons: Batch transaction returns array — need to capture updateMany result
- Effort: Small
- Risk: Low

## Technical Details

- **Affected files:** `src/app/api/posts/[id]/reject/route.ts`

## Acceptance Criteria

- [ ] Reject endpoint returns 409 if post already transitioned from PENDING_REVIEW
- [ ] Existing reject tests still pass
- [ ] New test for race condition case

## Work Log

- 2026-03-08: Created from code review of feat/ai-fulfillment-engine
