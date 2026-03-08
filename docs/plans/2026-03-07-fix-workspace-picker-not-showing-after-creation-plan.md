---
title: "fix: Workspace picker not showing after workspace creation"
type: fix
status: completed
date: 2026-03-07
---

# fix: Workspace picker not showing after workspace creation

## Overview

After creating a new workspace, the BusinessSelector (workspace picker) in the sidebar does not appear until after connecting a social account or performing a full page reload. Users expect the picker to be visible immediately after workspace creation.

## Problem Statement

The dashboard layout (`src/app/dashboard/layout.tsx`) is a **server component** that fetches businesses from the database and passes them to the `<Sidebar>` component. The sidebar conditionally renders the BusinessSelector only when `businesses.length > 0` (line 112).

When the user creates a workspace on `/dashboard/businesses/new`, the page navigates via `router.push()` to the onboard wizard and then to `/dashboard/accounts`. However, **neither navigation calls `router.refresh()`**, so Next.js App Router reuses the cached layout RSC payload with the stale `businesses = []` array. The BusinessSelector remains hidden until something else forces a server-side layout re-render (e.g., connecting an account).

## Root Cause

Two missing `router.refresh()` calls:

1. **`src/app/dashboard/businesses/new/page.tsx:47`** — navigates to onboard page without refreshing the layout
2. **`src/app/dashboard/businesses/[id]/onboard/page.tsx:122`** — navigates to accounts page without refreshing the layout

## Proposed Solution

Add `router.refresh()` before `router.push()` in both locations. This forces the server component layout to re-fetch businesses from the database, so the sidebar immediately reflects the new workspace.

### `src/app/dashboard/businesses/new/page.tsx`

```typescript
// After line 45: await update({ activeBusinessId: business.id });
router.refresh();
router.push(`/dashboard/businesses/${business.id}/onboard`);
```

### `src/app/dashboard/businesses/[id]/onboard/page.tsx`

```typescript
// Line 122: replace setTimeout(() => router.push(...), 2000)
setTimeout(() => {
  router.refresh();
  router.push("/dashboard/accounts");
}, 2000);
```

## Acceptance Criteria

- [x] After creating a new workspace, the BusinessSelector appears in the sidebar immediately on the onboard page
- [x] After completing onboarding and redirecting to accounts, the BusinessSelector remains visible
- [x] Existing workspace switching behavior is unchanged
- [x] No regression in the "Create workspace" nav link disappearing when businesses exist

## Context

- `router.refresh()` in Next.js App Router invalidates the cached RSC payload for the current route tree, forcing server components (like the layout) to re-execute their data fetches
- The sidebar already handles the UI correctly — the only issue is stale server data in the layout
