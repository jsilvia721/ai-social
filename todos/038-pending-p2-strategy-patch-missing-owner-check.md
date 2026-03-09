---
status: complete
priority: p2
issue_id: "038"
tags: [code-review, security, authorization, fulfillment-engine]
dependencies: []
---

# Strategy PATCH Missing Owner Role Check

## Problem Statement

`PATCH /api/businesses/[id]/strategy` checks for business membership but not the member's role. Any member can change `reviewWindowEnabled` and `reviewWindowHours`, which controls whether posts auto-approve. A non-owner member could enable auto-approval with a 1-hour window to bypass manual review.

**Flagged by:** security-sentinel, kieran-typescript-reviewer

## Findings

- `src/app/api/businesses/[id]/strategy/route.ts` lines 60-67: membership check only verifies `!membership`
- Compare: `src/app/api/fulfillment/run/route.ts` correctly enforces `membership.role === "OWNER"`

## Proposed Solutions

### Option A: Add owner role check (Recommended)
```typescript
if (!membership || membership.role !== "OWNER") {
  return NextResponse.json({ error: "Only owners can update strategy" }, { status: 403 });
}
```
- Effort: Small (5 min)

## Acceptance Criteria

- [ ] PATCH strategy endpoint requires OWNER role or admin
- [ ] GET strategy endpoint remains accessible to all members
- [ ] Test added for non-owner rejection

## Work Log

- 2026-03-08: Created from code review
