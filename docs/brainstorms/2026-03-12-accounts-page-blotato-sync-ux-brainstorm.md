---
title: "Accounts Page: Blotato Sync UX Redesign"
type: ux
status: ready-for-plan
date: 2026-03-12
origin: PR #45 — real Blotato API integration revealed connect flow needs redesign
---

# Accounts Page: Blotato Sync UX Redesign

## Context

PR #45 fixed the Blotato client to use the real v2 API. The real API has no OAuth connect endpoint — users must connect their social accounts on blotato.com first, then our app imports them via `GET /users/me/accounts`. The current per-platform "Connect" buttons imply direct OAuth and don't explain this prerequisite.

## What We're Building

Redesign the accounts page to use a **"Sync from Blotato"** model:

1. **Fetch Blotato accounts on page load** — call the Blotato API when the accounts page mounts to show what's available to import
2. **Inline selection UI** — show available (not-yet-imported) Blotato accounts as a checklist directly on the page, with "Select All" and "Import Selected" buttons
3. **Only show supported platforms** — filter to Twitter, Instagram, Facebook, TikTok, YouTube. Hide unsupported platforms (LinkedIn, Pinterest, Threads, Bluesky)
4. **Clear Blotato prerequisite messaging** — explain that users must connect accounts on blotato.com first, with a link
5. **Keep existing account cards** — already-imported accounts still show as platform cards with disconnect functionality

## Why This Approach

- **Matches reality**: Blotato manages OAuth tokens, not us. The UI should reflect this.
- **Batch import**: Users typically connect multiple platforms at once. One flow is better than 5 individual clicks.
- **Discoverability**: Fetching on load shows users what's available without requiring them to click each platform.
- **Selection control**: Users can pick which accounts to import rather than all-or-nothing, with Select All for convenience.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Connect model | Sync from Blotato (not per-platform OAuth) | Real API has no OAuth endpoint |
| Import mode | Selection checklist with Select All | User control + convenience |
| Fetch timing | On page load | Immediate context, shows available count |
| Selection UI | Inline section on accounts page | No extra click, always visible |
| Unsupported platforms | Hidden | Cleaner, no false expectations |
| Per-platform Connect buttons | Removed | Replaced by bulk import |

## UX Flow

### First Visit (no accounts imported)

```
┌─────────────────────────────────────────────┐
│  Accounts                                   │
│  Import your social accounts from Blotato   │
│                                             │
│  ┌─ Available on Blotato ─────────────────┐ │
│  │ ☑ Twitter/X  — @myhandle              │ │
│  │ ☑ Instagram  — @myinsta               │ │
│  │ ☐ Facebook   — My Page                │ │
│  │                                        │ │
│  │ [Select All]  [Import Selected (2)]    │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ┌─ Info ─────────────────────────────────┐ │
│  │ Don't see your account? Connect it on  │ │
│  │ blotato.com first, then refresh.       │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  No imported accounts yet.                  │
└─────────────────────────────────────────────┘
```

### After Import

```
┌─────────────────────────────────────────────┐
│  Accounts                                   │
│  Import your social accounts from Blotato   │
│                                             │
│  ┌─ Available on Blotato ─────────────────┐ │
│  │ ☐ Facebook   — My Page                │ │
│  │                                        │ │
│  │ [Import Selected (0)]                  │ │
│  │ (or: "All accounts imported!")         │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ┌ Twitter/X ┐  ┌ Instagram ┐              │
│  │ ✓ @myuser │  │ ✓ @myinsta│              │
│  │ Connected │  │ Connected │              │
│  │[Disconnect]│  │[Disconnect]│             │
│  └───────────┘  └───────────┘              │
└─────────────────────────────────────────────┘
```

### No Blotato Accounts (empty state)

```
┌─────────────────────────────────────────────┐
│  Accounts                                   │
│                                             │
│  ┌─ Connect via Blotato ──────────────────┐ │
│  │ No accounts found on Blotato.          │ │
│  │                                        │ │
│  │ To get started:                        │ │
│  │ 1. Go to blotato.com                   │ │
│  │ 2. Connect your social accounts there  │ │
│  │ 3. Come back here and refresh          │ │
│  │                                        │ │
│  │ [Go to Blotato ↗]  [Refresh]           │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## Scope

### In scope
- New Blotato accounts fetch on page load (client-side via new API endpoint)
- Inline selection checklist with Select All + Import Selected
- Bulk import API endpoint (accepts array of Blotato account IDs)
- Updated account cards (remove per-platform Connect buttons)
- Blotato prerequisite messaging + link
- Loading/error states for Blotato fetch
- Mock mode support (existing BLOTATO_MOCK flow)

### Out of scope
- Account selection for multiple accounts on same platform (take first match for now)
- Blotato account management (connecting/disconnecting on Blotato side)
- Onboarding wizard integration changes
- Mobile-specific layout changes beyond existing responsive patterns

## Technical Notes

- New API endpoint: `GET /api/accounts/available` — calls `listAccounts()` from Blotato, filters to supported platforms, excludes already-imported accounts
- New API endpoint: `POST /api/accounts/import` — accepts `{ accountIds: string[] }`, imports selected Blotato accounts
- Remove `GET /api/connect/blotato` redirect-based flow (replaced by client-side fetch + import)
- Keep callback route for now (unused but harmless)
