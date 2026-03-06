---
status: pending
priority: p1
issue_id: "003"
tags: [code-review, security, performance, auth, tokens]
dependencies: []
---

# Token refresh race condition with rotating refresh tokens

## Problem Statement

When multiple posts are published concurrently for the same account, each triggers `ensureValidToken` independently. If two requests both see an expired access token simultaneously, they both call the refresh endpoint. The first refresh invalidates the refresh token (OAuth2 rotation), so the second request uses a stale token and gets a 401. The second successful refresh writes a new token to the DB, potentially overwriting the first. This can permanently lock an account out if a request using an already-rotated token triggers another refresh.

## Findings

- **File:** `src/lib/token.ts`
- The scheduler processes posts every minute and may publish multiple posts for the same account in parallel
- No mutex, advisory lock, or database-level CAS (compare-and-swap) on the token refresh
- Twitter uses rotating refresh tokens (OAuth 2.0); Meta page tokens don't expire but also updated here
- Confirmed by: Security Sentinel, Performance Oracle

## Proposed Solutions

### Option A: Database advisory lock (Recommended)
- Acquire a Postgres advisory lock keyed on `socialAccountId` before reading + refreshing the token
- Release after writing the new token
- Pros: Works across multiple Node.js processes (Railway scales horizontally), atomic, no new dependencies
- Cons: Requires raw SQL advisory lock calls via `prisma.$executeRaw`
- Effort: Medium | Risk: Low
- Example: `SELECT pg_try_advisory_lock($1)` on account ID hash

### Option B: In-process singleton Map with Promise deduplication
- Store a `Map<accountId, Promise<token>>` in memory; if a refresh is in flight, await the existing Promise
- Pros: Simple, zero DB overhead
- Cons: Does not work across multiple Railway instances; not persistent across restarts
- Effort: Small | Risk: Medium (single-process only)

### Option C: Optimistic CAS with `updatedAt` check
- Read `tokenExpiresAt` + `updatedAt`, refresh, then update only `WHERE updatedAt = $oldUpdatedAt`
- If update returns 0 rows, re-read the fresh token (another process already refreshed it)
- Pros: No locks, works multi-process
- Cons: Slightly more complex; requires re-read on conflict
- Effort: Medium | Risk: Low

## Recommended Action

Option C (optimistic CAS) for simplicity without requiring advisory lock setup. Fall back to reading the now-fresh token if the update fails.

## Technical Details

- **Affected files:** `src/lib/token.ts`
- May also need to update the scheduler to sequence per-account rather than fully parallel

## Acceptance Criteria

- [ ] Concurrent token refreshes for the same account do not produce stale/invalid tokens
- [ ] If one refresh succeeds, subsequent calls use the refreshed token without re-refreshing
- [ ] Twitter account remains usable after concurrent publishing

## Work Log

- 2026-03-06: Identified by code review agents. Flagged P1.

## Resources

- PR #1: feat/milestone-1-platform-connect
