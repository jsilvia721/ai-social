---
status: pending
priority: p2
issue_id: "014"
tags: [code-review, typescript, calendar, timezone]
dependencies: []
---

# ContentCalendar: timezone mismatch — posts appear on wrong day

## Problem Statement

The calendar has two timezone inconsistencies:

1. **Client (`ContentCalendar.tsx:44-47`):** `toLocalDateKey` calls `new Date(dateStr)` which interprets the UTC ISO string in the **browser's local timezone**. A post scheduled for `2026-03-05T00:30:00Z` in a UTC-5 timezone shows as March 4.

2. **Server (`/api/posts/calendar/route.ts:20-21`):** `new Date(year, month, 1)` uses the **server's local timezone** for the month boundary. Currently safe (Railway is UTC) but fragile.

Both sides need to agree: either both use UTC, or both use user's local timezone.

## Findings

- **File:** `src/components/posts/ContentCalendar.tsx:44-47`, `src/app/api/posts/calendar/route.ts:20-21`
- Confirmed by: TypeScript Reviewer

## Proposed Solutions

### Option A: Force UTC everywhere (Recommended for consistency)
- Client: parse dates as UTC (`date.getUTCFullYear()`, `getUTCMonth()`, `getUTCDate()`)
- Server: use `new Date(Date.UTC(year, month, 1))` for range boundaries
- Pros: Predictable, matches how `scheduledAt` is stored
- Cons: Posts display in UTC time — may surprise users in non-UTC timezones

### Option B: Send local date key from server
- Include a `localDateKey` field in the API response (server formats in user's timezone)
- Pros: Correct for all users regardless of timezone
- Cons: Requires knowing user's timezone (from browser header or user preference)
- Effort: Medium | Risk: Low

## Recommended Action

Option A for now (UTC everywhere). Add a user timezone preference as a follow-up.

## Technical Details

- **Affected files:** `src/components/posts/ContentCalendar.tsx`, `src/app/api/posts/calendar/route.ts`

## Acceptance Criteria

- [ ] Server range uses `Date.UTC(...)` not `new Date(year, month, 1)`
- [ ] Client key generation uses UTC date methods
- [ ] A post at 2026-03-05T00:30:00Z always appears on March 5 in the calendar

## Work Log

- 2026-03-06: Identified by TypeScript Reviewer. Flagged P2.

## Resources

- PR #1: feat/milestone-1-platform-connect
