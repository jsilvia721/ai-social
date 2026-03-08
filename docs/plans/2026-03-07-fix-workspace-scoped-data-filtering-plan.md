---
title: "fix: Workspace-Scoped Data Filtering"
type: fix
status: completed
date: 2026-03-07
---

# fix: Workspace-Scoped Data Filtering

## Overview

When a user selects a workspace (business) via the `BusinessSelector`, the active business is persisted in the JWT session (`session.user.activeBusinessId`). However, most pages and API routes ignore this selection — they display data aggregated across **all** businesses the user belongs to. Posts, analytics, the dashboard overview, and the calendar must each be scoped to the currently active workspace.

## Problem Statement

The `activeBusinessId` is already tracked in the session (JWT + `User.activeBusinessId` DB column) and properly switched via `POST /api/businesses/switch`. However, four surfaces ignore it entirely:

| Surface | Current Behavior | Expected Behavior |
|---|---|---|
| `GET /api/posts` | Returns posts from all user's businesses | Returns posts for active business only |
| `GET /api/posts/calendar` | Calendar spans all businesses | Calendar shows active business only |
| Dashboard overview (`/dashboard/page.tsx`) | Stats aggregate all businesses | Stats scoped to active business |
| Analytics page (`/dashboard/analytics/page.tsx`) | Aggregates all businesses | Scoped to active business |

The accounts page and `PostComposer` already pass `activeBusinessId` correctly — no changes needed there.

## Root Cause

All data-fetching queries use a `memberFilter`:

```ts
// Current pattern — shows all businesses the user belongs to
const memberFilter = {
  business: { members: { some: { userId: session.user.id } } }
};
```

This filter authorizes access but does not scope to the active workspace. The fix adds a `businessId` clause to each query.

## Proposed Solution

### Server Components (dashboard overview + analytics)

Add `businessId: session.user.activeBusinessId` to each Prisma query in the server component alongside the existing membership check. If `activeBusinessId` is null/undefined (edge case: no business yet), fall back to showing an empty state or all businesses.

```ts
// Fixed pattern
const businessFilter = {
  businessId: session.user.activeBusinessId,
  business: { members: { some: { userId: session.user.id } } }
};
```

### API Routes (posts, posts/calendar)

Accept an optional `?businessId=` query param. If provided and valid (membership verified), filter by that businessId. Client pages pass `session.user.activeBusinessId` as the `?businessId=` param.

### Client Pages (posts list, calendar)

Read `activeBusinessId` from the session (same pattern already used in `accounts/page.tsx`) and append `?businessId=<id>` to API calls.

## Technical Considerations

- **Authorization preserved**: The membership check (`business: { members: { some: { userId } } }`) must remain on every query. The `businessId` filter adds scoping on top of auth — it does not replace it.
- **Null safety**: `activeBusinessId` can be `null` (user just created, not yet onboarded). Pages should handle this gracefully — show an empty state or prompt to select/create a business.
- **No schema changes**: All foreign keys already exist (`Post.businessId`, `SocialAccount.businessId`). No migrations needed.
- **Session type**: `session.user.activeBusinessId` is typed as `string | null | undefined` via the NextAuth callbacks. Cast pattern already used in `accounts/page.tsx:28–29` should be reused.

## Files to Change

### API Routes

**`src/app/api/posts/route.ts`** (lines 18–21)
- `GET`: Read `?businessId=` param, add to filter if present; verify membership still holds
- `DELETE` and `POST`: No change needed (DELETE is by id+auth, POST already requires businessId in body)

**`src/app/api/posts/calendar/route.ts`** (lines 38–45)
- `GET`: Read `?businessId=` param, add to filter if present

### Server Components

**`src/app/dashboard/page.tsx`** (line 40)
- Add `businessId: session.user.activeBusinessId` to the `memberFilter` object used in all 7 `Promise.all` queries
- If `activeBusinessId` is null, show empty/onboarding state

**`src/app/dashboard/analytics/page.tsx`** (line 29)
- Same fix as dashboard overview

### Client Pages

**`src/app/dashboard/posts/page.tsx`**
- Read `activeBusinessId` from session
- Append `?businessId=<activeBusinessId>` to the `fetch('/api/posts?...')` call

**`src/app/dashboard/posts/calendar/page.tsx`** (if exists)
- Same pattern as posts page

## Acceptance Criteria

- [x] Switching workspace via `BusinessSelector` immediately scopes the posts list to that workspace's posts
- [x] Dashboard overview stat cards (total posts, scheduled, published, accounts, likes, impressions) reflect only the active workspace
- [x] Analytics page metrics reflect only the active workspace
- [x] The calendar view shows only posts scheduled under the active workspace
- [x] `POST /api/posts` still works correctly (already scopes by `businessId` in body)
- [x] Accounts page continues to work correctly (already scoped — no regression)
- [x] If user has no active business (null `activeBusinessId`), pages show an appropriate empty state instead of crashing
- [x] All existing tests pass; new tests added for businessId filtering behavior
- [x] `GET /api/posts?businessId=<other_business_id>` where user is NOT a member returns empty (membership filter handles auth)

## System-Wide Impact

**Interaction graph:** BusinessSelector → `POST /api/businesses/switch` → updates `User.activeBusinessId` in DB → `update()` patches JWT → `router.refresh()` re-renders server components → dashboard/analytics now picks up new businessId from session.

**Error propagation:** If `activeBusinessId` is stale (e.g., user was removed from business), the membership check will correctly filter out results. The query returns empty rather than erroring.

**State lifecycle risks:** None — this is a read-only filtering change. No writes are altered. The existing membership cascade deletes handle cleanup if a business is removed.

**API surface parity:** `GET /api/accounts` already supports optional `?businessId=` — the posts routes should mirror this pattern exactly.

## Test Plan

| Test | File |
|---|---|
| `GET /api/posts` filters by `businessId` when param provided | `src/__tests__/api/posts.test.ts` |
| `GET /api/posts` without `businessId` returns all user's posts | `src/__tests__/api/posts.test.ts` |
| `GET /api/posts?businessId=<non-member-id>` returns 403 or empty | `src/__tests__/api/posts.test.ts` |
| `GET /api/posts/calendar` filters by `businessId` | `src/__tests__/api/posts-calendar.test.ts` |
| Dashboard overview test verifies `businessId` scoping | `src/__tests__/api/dashboard.test.ts` (or server component test) |

## Implementation Order

1. **`GET /api/posts`** — add optional `?businessId=` param with membership check
2. **`GET /api/posts/calendar`** — same pattern
3. **Dashboard overview** (`/dashboard/page.tsx`) — add `businessId` to all Prisma queries
4. **Analytics page** — same as dashboard
5. **Posts list client page** — pass `activeBusinessId` to API call
6. **Write/update tests** for each change above
7. **Manual verify** by switching workspaces and confirming data changes

## Sources & References

### Internal References

- Session/activeBusinessId storage: `src/lib/auth.ts:27–68`
- Business switch API: `src/app/api/businesses/switch/route.ts:24–28`
- BusinessSelector switching logic: `src/components/dashboard/Sidebar.tsx:83–98`
- Accounts page (working pattern to copy): `src/app/dashboard/accounts/page.tsx:28–53`
- Posts API (current unscoped filter): `src/app/api/posts/route.ts:18–21`
- Calendar API (current unscoped filter): `src/app/api/posts/calendar/route.ts:38–45`
- Dashboard overview (current unscoped queries): `src/app/dashboard/page.tsx:39–56`
- Analytics page (current unscoped queries): `src/app/dashboard/analytics/page.tsx:29`
- Prisma schema — Business/Post/SocialAccount relations: `prisma/schema.prisma:61–149`
