# Mobile-First UI Rules

Applies when working on files in `src/components/` or `src/app/`.

## Requirements

- All new UI features must be mobile-responsive (mobile-first, then desktop)
- Sidebar: collapsible on mobile with hamburger menu (md: breakpoint), fixed header bar on mobile
- Dashboard layout: `pt-14 md:pt-0 md:ml-60` — accounts for mobile header and desktop sidebar
- Use `flex-col sm:flex-row` pattern for page headers with actions
- Calendar views: horizontal scroll on mobile via `overflow-x-auto` + `minWidth`
- Split panels (FulfillmentPanel): full-screen overlay on mobile, side panel on desktop
- PostCard: stacked layout on mobile, inline on desktop
- Tailwind breakpoints: sm (640px), md (768px), lg (1024px)
- `useMobileSidebar()` context exported from Sidebar for other components to control
