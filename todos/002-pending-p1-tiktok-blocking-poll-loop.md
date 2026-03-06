---
status: pending
priority: p1
issue_id: "002"
tags: [code-review, performance, tiktok, scheduler]
dependencies: []
---

# TikTok: Blocking 30s polling loop inside API route / scheduler

## Problem Statement

`waitForPublishStatus` in `src/lib/platforms/tiktok/index.ts` is a synchronous `while` loop with `setTimeout(r, 2000)` pauses, running up to 15 iterations (30 seconds total). It blocks the Node.js event loop for the full duration inside an API route or cron scheduler invocation. Railway's HTTP timeout is 30 seconds, meaning the request will time out before the loop resolves in worst-case scenarios. It also holds a server connection/thread for the full duration.

## Findings

- **File:** `src/lib/platforms/tiktok/index.ts:42-74`
- Loop runs up to 15 × 2000ms = 30s blocking
- Called from the scheduler which runs every minute — a stuck TikTok job blocks all subsequent scheduler ticks
- Railway default HTTP timeout is 30s
- Confirmed by: Performance Oracle, Architecture Strategist, TypeScript Reviewer

## Proposed Solutions

### Option A: Fire-and-forget + scheduler polling (Recommended)
- `publishTikTokVideo` calls the init endpoint and saves `publish_id` + status `PROCESSING` to the DB
- The hourly metrics refresh (or a new scheduler task) polls TikTok's status endpoint and updates to PUBLISHED/FAILED
- Pros: No blocking, idiomatic async pattern, works with existing scheduler infrastructure
- Cons: Final status available after next scheduler tick (up to 1 minute delay), more DB state
- Effort: Medium | Risk: Low

### Option B: TikTok webhook callback
- Register a webhook URL with TikTok; receive status update asynchronously
- Pros: Real-time status, no polling
- Cons: TikTok webhook setup complexity, requires public endpoint, harder to test
- Effort: Large | Risk: Medium

### Option C: Move polling to a background worker with timeout
- Spawn a background task (setTimeout with no await) to poll independently
- Pros: Non-blocking, quick to implement
- Cons: Fire-and-forget loses errors; Railway may kill orphaned async tasks mid-poll
- Effort: Small | Risk: Medium

## Recommended Action

Option A. Persist `publish_id` in a new column or as post metadata, and poll from the existing scheduler.

## Technical Details

- **Affected files:** `src/lib/platforms/tiktok/index.ts`, `src/lib/scheduler.ts`, `prisma/schema.prisma` (potentially)
- Need to decide: new `publishId` column on Post, or store in a JSON metadata field

## Acceptance Criteria

- [ ] No `while` polling loop in the TikTok publish code path
- [ ] TikTok publish call returns quickly (< 5s) regardless of processing time
- [ ] Post status eventually transitions from SCHEDULED → PROCESSING → PUBLISHED/FAILED
- [ ] Scheduler is not blocked if TikTok is slow to process

## Work Log

- 2026-03-06: Identified by code review agents. Flagged P1.

## Resources

- PR #1: feat/milestone-1-platform-connect
- TikTok Content Posting API: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
