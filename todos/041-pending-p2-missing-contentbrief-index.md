---
status: complete
priority: p2
issue_id: "041"
tags: [code-review, performance, database, fulfillment-engine]
dependencies: []
---

# Missing ContentBrief Index for Fulfillment Query

## Problem Statement

The core fulfillment query at `src/lib/fulfillment.ts:244-259` filters by `status = PENDING AND scheduledFor <= lookaheadEnd`, then orders by `sortOrder, scheduledFor`. No existing index on ContentBrief covers this pattern, causing a filesort as the table grows.

## Findings

- Existing ContentBrief indexes: `[businessId, status]`, `[status, weekOf]` — neither covers `(status, scheduledFor)`
- `recoverStuckBriefs()` also queries `(status, updatedAt)` without an index

## Proposed Solutions

### Option A: Add composite index (Recommended)
```prisma
@@index([status, scheduledFor, sortOrder])
```
- Covers the WHERE + ORDER BY in a single B-tree scan
- Also add `@@index([status, updatedAt])` for stuck-brief recovery
- Effort: Small (new migration)

## Acceptance Criteria

- [ ] ContentBrief has `@@index([status, scheduledFor])` or similar
- [ ] Migration created and tested

## Work Log

- 2026-03-08: Created from code review
