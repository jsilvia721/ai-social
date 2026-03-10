---
status: complete
priority: p2
issue_id: "040"
tags: [code-review, security, authorization, fulfillment-engine]
dependencies: []
---

# Review Page Missing Business Membership Check

## Problem Statement

The review page at `/dashboard/review` uses `session.user.activeBusinessId` to scope its query but does not verify the user is a member of that business. Since `activeBusinessId` is set client-side, a user could view PENDING_REVIEW posts for a business they don't belong to. This is read-only information disclosure — approve/reject APIs properly check membership.

## Findings

- `src/app/dashboard/review/page.tsx` lines 13-36: uses `activeBusinessId` without membership verification
- Other dashboard pages may have the same pattern (lower priority — the review page shows sensitive draft content)

## Proposed Solutions

### Option A: Add membership check before query
```typescript
const membership = await prisma.businessMember.findUnique({
  where: { businessId_userId: { businessId: activeBusinessId, userId: session.user.id } },
});
if (!membership) {
  return <div className="text-center py-16 text-zinc-400">Not authorized.</div>;
}
```
- Effort: Small (10 min)

## Acceptance Criteria

- [ ] Review page verifies business membership before querying posts
- [ ] Non-members see appropriate error message

## Work Log

- 2026-03-08: Created from code review
