---
status: complete
priority: p2
issue_id: "044"
tags: [code-review, quality, fulfillment-engine]
dependencies: []
---

# matchPillar Fuzzy Matching Produces False Positives

## Problem Statement

`matchPillar()` in `src/lib/fulfillment.ts:114-121` uses bidirectional substring matching. A pillar "AI" would match any topic containing "ai" (e.g., "email", "certain", "maintain"). Short pillar names will produce many false matches.

Also duplicated in `src/app/api/briefs/[id]/fulfill/route.ts` (lines 93-99).

## Proposed Solutions

### Option A: Remove and set topicPillar to null (Simplest)
If pillar matching isn't critical yet, remove and add proper matching later.

### Option B: Use word-boundary matching
```typescript
const regex = new RegExp(`\\b${escapeRegex(p)}\\b`, 'i');
return pillars.find(p => regex.test(topic)) ?? null;
```

Either way, extract to a shared utility to eliminate duplication.

- Effort: Small

## Work Log

- 2026-03-08: Created from code review
