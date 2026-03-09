---
status: complete
priority: p2
issue_id: "042"
tags: [code-review, performance, frontend, fulfillment-engine]
dependencies: []
---

# ReviewCard Countdown Interval Not Cleared on Expiry

## Problem Statement

In `ReviewCard.tsx` lines 50-66, when the countdown reaches zero (`remaining <= 0`), `router.refresh()` is called but the interval is not cleared. The interval continues firing every 60 seconds, calling `router.refresh()` repeatedly until React unmounts the component.

## Proposed Solutions

Add `clearInterval(id)` when countdown reaches zero:
```typescript
if (remaining <= 0) {
  setCountdownText("Auto-approving...");
  clearInterval(id); // <-- fix
  router.refresh();
  return;
}
```
- Effort: Trivial (1 line)

## Acceptance Criteria

- [ ] Interval cleared when countdown expires

## Work Log

- 2026-03-08: Created from code review
