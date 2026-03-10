---
status: complete
priority: p2
issue_id: "031"
tags: [code-review, performance, lambda, scheduler]
dependencies: []
---

# MetricsRefresh fetches all published posts with no limit — will timeout at scale

## Problem Statement

`runMetricsRefresh()` fetches all published posts with stale metrics in a single query, then fans out with `Promise.allSettled()`. Each post fires one external API call. With 100 posts this is 100 concurrent outbound API calls. At 1000 posts (plausible over months), this will breach the 5-minute Lambda timeout.

Additionally, Twitter's v2 API enforces 15 requests per 15 minutes on the tweet lookup endpoint. With more than 15 Twitter posts, the first MetricsRefresh invocation will hit rate limits and silently discard results.

## Findings

- **File:** `src/lib/scheduler.ts:98-108` — `runMetricsRefresh()` unbounded `findMany`
- Lambda timeout: 5 minutes — sufficient for ~50-100 posts with API latency
- Twitter rate limit: 15 req/15 min on v2 tweet lookup
- Confirmed by: Performance Oracle

## Proposed Solutions

### Option A: Add `take: N` limit + cursor-based pagination across invocations (Recommended)
- Add `take: 50` to the query
- Track last-processed cursor (e.g., `metricsUpdatedAt` ascending order)
- Each hourly invocation processes the oldest 50 stale posts
- Pros: Predictable runtime; respects rate limits; scales indefinitely
- Cons: Full metrics refresh takes longer when posts accumulate
- Effort: Medium | Risk: Low

### Option B: Add `take: 50` only, reset each invocation
- Limit to 50 per run; always start from oldest stale
- Pros: Simple; no cursor state needed
- Cons: If there are always >50 stale posts, same 50 always get refreshed while newer posts are ignored
- Effort: Small | Risk: Low

### Option C: Parallel batched per-platform with rate-limit awareness
- Group posts by platform; enforce platform-specific rate limits (15/15min for Twitter)
- Pros: Full correctness; maximally efficient
- Cons: Complex; over-engineered for POC scale
- Effort: Large | Risk: Low

## Recommended Action

Option B now (add `take: 50`); Option A when post count grows.

## Technical Details

- **Affected files:** `src/lib/scheduler.ts`
- Current: `prisma.post.findMany({ where: { status: "PUBLISHED", metricsUpdatedAt: { lt: staleThreshold } } })`
- Fix: add `take: 50, orderBy: { metricsUpdatedAt: "asc" }`

## Acceptance Criteria

- [ ] `runMetricsRefresh` queries at most 50 posts per invocation
- [ ] Posts are ordered by `metricsUpdatedAt ASC` (oldest stale first)
- [ ] Lambda runtime stays well under 5 minutes with 50 concurrent API calls

## Work Log

- 2026-03-06: Identified by Performance Oracle during AWS migration PR review.

## Resources

- PR #2: feat/aws-sst-migration
