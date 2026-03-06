---
status: pending
priority: p2
issue_id: "013"
tags: [code-review, performance, api]
dependencies: []
---

# GET /api/posts has no pagination — unbounded query

## Problem Statement

`GET /api/posts` returns all posts for the user with no limit or pagination. As post count grows, this query returns an ever-larger result set, increasing DB load, response size, and client memory usage. At 10,000 posts, this becomes a serious performance issue.

## Findings

- **File:** `src/app/api/posts/route.ts`
- `findMany` with no `take`/`skip`
- Confirmed by: Performance Oracle

## Proposed Solutions

### Option A: Cursor-based pagination
- Add `?cursor=<postId>&limit=50` query params
- Pros: Efficient for large datasets, stable under concurrent inserts
- Effort: Medium | Risk: Low

### Option B: Offset-based pagination (simpler)
- Add `?page=1&limit=50` query params
- Pros: Simple, client can jump to any page
- Cons: Unstable under concurrent inserts (skip N can miss/duplicate rows)
- Effort: Small | Risk: Low

## Recommended Action

Option B for now (simplicity). Can migrate to cursor-based if scale demands it.

## Technical Details

- **Affected files:** `src/app/api/posts/route.ts`, `src/app/dashboard/posts/page.tsx` (client update)

## Acceptance Criteria

- [ ] `GET /api/posts` accepts `limit` (default 50, max 200) and `page` params
- [ ] Response includes total count for pagination UI
- [ ] Existing tests updated

## Work Log

- 2026-03-06: Identified by Performance Oracle. Flagged P2.

## Resources

- PR #1: feat/milestone-1-platform-connect
