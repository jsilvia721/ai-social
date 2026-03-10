---
title: "feat: Strategy Digest Insights Page"
type: feat
status: completed
date: 2026-03-08
origin: docs/brainstorms/2026-03-08-strategy-digest-ui-brainstorm.md
---

# feat: Strategy Digest Insights Page

## Overview

Add a read-only `/dashboard/insights` page that surfaces weekly AI performance digests to the business partner. The M3 strategy optimizer already runs weekly and creates `StrategyDigest` records — this page makes them visible.

## Proposed Solution

Server component page with a client-component week picker island. Uses URL search params (`?week=2026-03-02`) for week navigation so the page stays server-rendered. Four content sections per digest: Summary, Top Performers, Key Insights, Strategy Adjustments.

(See brainstorm: `docs/brainstorms/2026-03-08-strategy-digest-ui-brainstorm.md`)

## Technical Approach

### Architecture

- **Page type:** Server component (`src/app/dashboard/insights/page.tsx`) following the analytics page pattern
- **Week picker:** Client component island using `router.push` with search params
- **Data fetching:** Direct Prisma queries (not API calls), scoped to `activeBusinessId`
- **Auth:** Membership check following `/dashboard/review` pattern, admin bypass via `isAdmin`
- **Post resolution:** Join top performer `postId`s against Post table for content/platform display
- **JSON parsing:** Use existing `DigestPatternsSchema` / `DigestChangesSchema` from `src/lib/optimizer/schemas.ts`

### Key Design Decisions

1. **URL search params for week selection** — keeps page as server component, supports browser back/forward, shareable URLs
2. **Last 12 weeks** of history in the week picker (one quarter)
3. **Human-readable strategy adjustments** — format mix deltas as "+5% text posts", cadence as "+1 tweet/week"
4. **Skip deleted posts** silently in Top Performers rather than showing broken references
5. **Sidebar placement:** After "Analytics", before "Content Queue", using `Lightbulb` icon

## Implementation Phases

### Phase 1: Page + Sidebar Link

**New files:**
- `src/app/dashboard/insights/page.tsx` — server component
- `src/app/dashboard/insights/loading.tsx` — skeleton loader
- `src/components/insights/WeekPicker.tsx` — client component (`"use client"`)
- `src/__tests__/api/insights-page.test.ts` — test the data-fetching/rendering logic

**Modified files:**
- `src/components/dashboard/Sidebar.tsx` — add "Insights" nav link

**Page structure:**
```
┌─────────────────────────────────────────┐
│  Weekly Insights          [Week Picker] │
│  AI-powered performance analysis        │
├─────────────────────────────────────────┤
│  📊 Summary                             │
│  Card with digest.summary text          │
├─────────────────────────────────────────┤
│  🏆 Top Performers                      │
│  List: post content snippet, platform   │
│  icon, engagement score (e.g. "4.2x")   │
├─────────────────────────────────────────┤
│  💡 Key Insights                        │
│  Bulleted list from patterns.insights   │
├─────────────────────────────────────────┤
│  🔄 Strategy Adjustments               │
│  Format mix: "+5% image, -5% text"      │
│  Cadence: "+1 tweet/week"               │
│  Topic insights as bullets              │
└─────────────────────────────────────────┘
```

**Data flow (server component):**
1. `getServerSession(authOptions)` → redirect if no session
2. Extract `activeBusinessId`, `isAdmin`, `userId` from session
3. If no `activeBusinessId` → show "Select a workspace" empty state
4. Verify membership (admins bypass) → show error if not a member
5. Read `?week` search param; default to latest digest's `weekOf`
6. Query digests: `prisma.strategyDigest.findMany({ where: { businessId }, orderBy: { weekOf: "desc" }, take: 12 })`
7. Find the selected digest from the array (match `weekOf` to search param, or use first)
8. Resolve top performer post IDs: `prisma.post.findMany({ where: { id: { in: postIds } } })`
9. Parse JSON fields with Zod schemas for type safety
10. Render sections

**WeekPicker component:**
- Receives `weeks: { weekOf: string; isCurrent: boolean }[]` and `selected: string` as props
- Renders a `<select>` dropdown (mobile-friendly) with "Week of Mar 2, 2026" labels
- On change: `router.push(\`/dashboard/insights?week=\${value}\`)`

**Empty states:**
- No `activeBusinessId`: "Select a workspace to view insights"
- No digests: "Your first weekly insight will appear after the optimizer runs. The optimizer needs at least 10 published posts with engagement data."
- Empty `changes`: "No strategy adjustments this week — current strategy is performing well."

**Mobile layout:**
- All sections stack vertically (already natural with `space-y-6`)
- Week picker is a native `<select>` (good touch target)
- Top performers list uses `flex-col` with platform icon + text on one line

### Phase 2: Tests

**Test file:** `src/__tests__/api/insights-page.test.ts`

Since no server component page tests exist in the codebase, test the data-fetching helpers if extracted, or test via the existing digests API route. At minimum:
- Verify digests API returns correct shape (existing `src/__tests__/api/digests.test.ts` covers this)
- Add test for the `WeekPicker` component rendering and navigation behavior if feasible
- Verify Zod parsing of `patterns` and `changes` JSON handles edge cases (empty objects, missing fields)

## Acceptance Criteria

- [x] `/dashboard/insights` page renders latest digest with all 4 sections
- [x] Week picker navigates between available digests via URL search params
- [x] Top Performers shows post content snippets with platform icons and engagement scores
- [x] Strategy Adjustments displays human-readable format ("+5% image posts", "+1 tweet/week")
- [x] Empty states for: no workspace, no digests, empty changes section
- [x] "Insights" link in sidebar with `Lightbulb` icon, after Analytics
- [x] Loading skeleton via `loading.tsx`
- [x] Mobile-responsive layout
- [x] Membership authorization check (admin bypass)
- [x] `npm run ci:check` passes

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-08-strategy-digest-ui-brainstorm.md](docs/brainstorms/2026-03-08-strategy-digest-ui-brainstorm.md) — key decisions: read-only, latest-focused with week picker, server component
- **Digest data model:** `prisma/schema.prisma:254-266` (StrategyDigest)
- **Digest JSON schemas:** `src/lib/optimizer/schemas.ts:39-59` (DigestPatternsSchema, DigestChangesSchema)
- **Optimizer pipeline:** `src/lib/optimizer/run.ts:111-275` (how digests are created)
- **Existing digests API:** `src/app/api/businesses/[id]/digests/route.ts`
- **Dashboard page pattern:** `src/app/dashboard/analytics/page.tsx` (memberFilter, layout)
- **Review page auth pattern:** `src/app/dashboard/review/page.tsx:23-34` (membership check)
- **Sidebar nav:** `src/components/dashboard/Sidebar.tsx:29-37` (NAV_LINKS array)
