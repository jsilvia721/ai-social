---
status: complete
priority: p3
issue_id: "047"
tags: [code-review, performance, frontend, fulfillment-engine]
dependencies: []
---

# Sidebar Badge Polling Over-Fetches Data

## Problem Statement

The sidebar fetches `/api/posts?status=PENDING_REVIEW&businessId=X&limit=1` every 60s to get a count. This executes two queries (findMany + count) with a socialAccount join, returning full post objects that are discarded. For a badge that needs only an integer count, this is wasteful.

## Proposed Solutions

Create a dedicated lightweight endpoint `GET /api/posts/review-count` that returns `{ count: number }` using `prisma.post.count()`. Covered by existing `@@index([businessId, status])`.

- Effort: Small

## Work Log

- 2026-03-08: Created from code review
