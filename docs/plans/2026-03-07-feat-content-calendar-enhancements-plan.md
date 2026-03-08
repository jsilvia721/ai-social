---
title: "feat: Content Calendar Enhancements"
type: feat
status: completed
date: 2026-03-07
origin: docs/brainstorms/2026-03-05-autonomous-social-platform-roadmap-brainstorm.md
---

# feat: Content Calendar Enhancements

A basic ContentCalendar already exists (month grid with post dots, month navigation, platform legend, list/calendar toggle). This plan covers four enhancements to make it a proper interactive scheduling tool, per Milestone 1 of the roadmap: "Content calendar / queue view (replace basic post list)."

## Acceptance Criteria

### 1. Click Day to See Posts
- [x] Clicking a day cell opens a slide-out panel showing all posts for that day with full details (content, platform, status, scheduled time, media thumbnails)
- [x] Clicking an empty day shows an empty state with a "Schedule a post" CTA that pre-fills the date
- [x] Clicking "+N more" overflow also opens the day panel
- [x] Panel closes via X button, Escape key, or clicking a different day
- [x] Padding cells (adjacent month days) are inert — no interaction

### 2. Click Post to Edit
- [x] Clicking a SCHEDULED or DRAFT post in the day panel navigates to `/dashboard/posts/[id]/edit`
- [x] The edit page includes a "Back to Calendar" link (or the browser back button returns to calendar view)
- [x] PUBLISHED posts are not clickable for editing — show a view-only detail instead
- [x] FAILED posts are clickable for editing (align UI with API — PATCH allows editing FAILED posts)
- [x] After saving edits, navigating back to the calendar shows updated data

### 3. Drag-and-Drop Reschedule
- [x] SCHEDULED posts are draggable in month view; PUBLISHED and FAILED posts are not draggable
- [x] Dragging a post to a different day PATCHes `scheduledAt` with the new date, preserving the original time-of-day
- [x] Dragging to a past date is prevented (visual feedback: invalid drop target)
- [x] Server-side validation added to `PATCH /api/posts/[id]` rejecting `scheduledAt` in the past
- [x] Optimistic UI update on drop; rollback with undo toast on PATCH failure
- [x] Same-day drop is a no-op (no API call)
- [x] Drag preview shows post content snippet and platform dot
- [x] Valid drop target cells are visually highlighted during drag
- [x] On touch devices, drag-and-drop is disabled — users edit the scheduled date via the edit page instead
- [x] Keyboard alternative: select post with Enter, arrow keys to target day, Enter to confirm move

### 4. Week View
- [x] Sub-toggle within Calendar view: Month / Week (main toggle stays List vs Calendar)
- [x] Week view shows 7 columns (Mon-Sun) with hourly time slots (6 AM - 11 PM)
- [x] Posts are placed at their scheduled hour; posts outside the visible range appear at the top/bottom edge
- [x] Auto-scrolls to current hour on initial load
- [x] Prev/next navigation moves by 7 days; header shows date range (e.g., "Mar 2 - Mar 8, 2026")
- [x] Switching from month to week shows the week containing today (or the selected day if one was clicked)
- [x] API: add optional `startDate`/`endDate` ISO params to `GET /api/posts/calendar` (falls back to `year`/`month` when those are provided)
- [x] Drag-and-drop in week view changes both date AND time (drop on hour slot sets time to that hour, on the hour)
- [x] Click interactions (day panel, post edit) work the same as in month view

## Context

### Key Files
- `src/components/posts/ContentCalendar.tsx` — existing month grid (enhance + extract shared logic)
- `src/app/dashboard/posts/page.tsx` — view toggle, data fetching, state management
- `src/app/api/posts/calendar/route.ts` — calendar API (add `startDate`/`endDate` support)
- `src/app/api/posts/[id]/route.ts` — PATCH route (add past-date validation)
- `src/components/posts/PostCard.tsx` — status/platform color maps (reuse in day panel)
- `src/components/posts/PostComposer.tsx` — edit mode (used by edit page)

### New Files
- `src/components/posts/DayDetailPanel.tsx` — slide-out panel for day posts
- `src/components/posts/WeekCalendar.tsx` — week view with hourly grid

### Dependencies
- `@dnd-kit/core` + `@dnd-kit/sortable` — drag-and-drop (supports pointer, touch fallback disabled, keyboard accessible)
- No date library needed — continue using native `Date` and `Date.UTC()`

### Design Decisions
- **Slide-out panel** (not modal) for day details — keeps calendar visible for context
- **Navigate to edit page** for post editing (not inline modal) — avoids PostComposer refactoring, edit page already works
- **Preserve time on month-view drag** — only the date component of `scheduledAt` changes
- **SCHEDULED-only drag** — PUBLISHED is blocked by API, FAILED should use retry flow instead
- **Sub-toggle for Month/Week** — avoids cluttering the main List/Calendar toggle
- **6 AM - 11 PM hour range** — covers typical social media posting hours, reduces vertical scroll

### Implementation Order
1. Click day to see posts (establishes panel pattern)
2. Click post to edit (builds on panel)
3. Drag-and-drop in month view (requires panel for rollback UX)
4. Week view (most complex, depends on API changes + drag architecture)

## Sources

- **Origin brainstorm:** [docs/brainstorms/2026-03-05-autonomous-social-platform-roadmap-brainstorm.md](docs/brainstorms/2026-03-05-autonomous-social-platform-roadmap-brainstorm.md) — Milestone 1: "Content calendar / queue view (replace basic post list)"
- Existing calendar API tests: `src/__tests__/api/posts/calendar.test.ts`
- Existing posts API tests: `src/__tests__/api/posts.test.ts`
