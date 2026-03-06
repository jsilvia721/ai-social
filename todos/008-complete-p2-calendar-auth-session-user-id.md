---
status: pending
priority: p2
issue_id: "008"
tags: [code-review, security, auth, calendar]
dependencies: []
---

# Calendar route: auth check does not assert session.user.id

## Problem Statement

`src/app/api/posts/calendar/route.ts` checks `if (!session)` but then unconditionally accesses `session.user.id`. In NextAuth v4, a valid session object can exist without a `user.id` if the session callback is misconfigured. This would silently pass the auth guard and query Prisma with `userId: undefined`, either throwing an unexpected error or returning all/no rows without a clear auth failure.

## Findings

- **File:** `src/app/api/posts/calendar/route.ts:8,25`
- Other routes in the codebase correctly check `if (!session?.user?.id)`
- Confirmed by: TypeScript Reviewer

## Proposed Solutions

### Option A: Match the pattern used elsewhere
```ts
if (!session?.user?.id) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```
- One-line fix
- Effort: Very Small | Risk: None

## Recommended Action

Apply Option A immediately.

## Technical Details

- **Affected files:** `src/app/api/posts/calendar/route.ts`

## Acceptance Criteria

- [ ] Auth guard checks `session?.user?.id`, not just `session`
- [ ] Request with valid session but missing `user.id` returns 401

## Work Log

- 2026-03-06: Identified by TypeScript Reviewer. Flagged P2.

## Resources

- PR #1: feat/milestone-1-platform-connect
