---
title: "feat: Redesign accounts page with Blotato sync model"
type: feat
status: active
date: 2026-03-12
origin: docs/brainstorms/2026-03-12-accounts-page-blotato-sync-ux-brainstorm.md
---

# feat: Redesign accounts page with Blotato sync model

## Overview

Replace per-platform "Connect" buttons with a "Sync from Blotato" model that fetches available accounts on page load, presents an inline selection checklist, and bulk-imports selected accounts. This matches how the real Blotato API works — users connect social accounts on blotato.com, and our app imports them.

(see brainstorm: docs/brainstorms/2026-03-12-accounts-page-blotato-sync-ux-brainstorm.md)

## Problem Statement

PR #45 aligned the Blotato client with the real v2 API, revealing there is no OAuth connect endpoint. The current per-platform "Connect" buttons navigate to a server-side redirect flow that no longer makes sense. Users have no visibility into what's available on Blotato, and no explanation that they must connect accounts on blotato.com first.

## Proposed Solution

### Architecture

```
Page Load:
  AccountsPage (client) → GET /api/accounts/available → listAccounts() (Blotato API)
                         → GET /api/accounts (existing) → DB query

Import:
  User selects checkboxes → POST /api/accounts/import { accountIds } → re-validate via Blotato API → DB transaction
```

### Implementation Phases

#### Phase 1: Backend — New API Endpoints

**1a. `GET /api/accounts/available`** — `src/app/api/accounts/available/route.ts`

Fetches Blotato accounts, filters to supported platforms, excludes already-imported ones.

```typescript
// Response shape:
{
  accounts: Array<{
    id: string;          // Blotato account ID
    platform: Platform;  // Mapped to Prisma enum (uppercase)
    username: string;
    fullname?: string;
  }>
}
```

Logic:
- Auth check + business membership check (admin bypass) using `session.user.activeBusinessId`
- Call `listAccounts()` from `src/lib/blotato/accounts.ts`
- Filter: only platforms in our `BLOTATO_TO_PRISMA` mapping (twitter, instagram, facebook, tiktok, youtube)
- Exclude: accounts whose `blotatoAccountId` already exists in `SocialAccount` table (globally, not just current business — prevents cross-business claiming conflicts)
- Map platform names from Blotato lowercase to Prisma uppercase in response
- Mock mode: `shouldMockExternalApis()` already handled in `listAccounts()`

**1b. `POST /api/accounts/import`** — `src/app/api/accounts/import/route.ts`

Bulk-imports selected Blotato accounts into the current business.

```typescript
// Request:
{ accountIds: string[] }

// Response (201):
{
  imported: Array<{
    id: string;          // SocialAccount ID
    platform: Platform;
    username: string;
    blotatoAccountId: string;
  }>
}
```

Logic:
- Auth check + business membership check using `session.user.activeBusinessId`
- Validate `accountIds` is a non-empty string array (max 20 items)
- Re-fetch `listAccounts()` from Blotato to validate each submitted ID exists and maps to a supported platform (prevents tampered requests)
- Use `prisma.$transaction()` for all-or-nothing import:
  - For each valid account: `prisma.socialAccount.upsert()` with `blotatoAccountId` as the natural key
  - If any fails (e.g., unique constraint), the whole transaction rolls back
- Return the list of created/updated accounts

**1c. Tests** — TDD, write before implementation

- `src/__tests__/api/accounts/available.test.ts`
  - 401 unauthenticated
  - 400 no active business
  - 403 non-member
  - Filters to supported platforms only
  - Excludes already-imported accounts (by blotatoAccountId)
  - Excludes accounts claimed by other businesses
  - Returns mapped platform names (uppercase)
  - Handles Blotato API failure (500 with error message)

- `src/__tests__/api/accounts/import.test.ts`
  - 401 unauthenticated
  - 400 missing/empty accountIds
  - 400 invalid accountIds (not in Blotato response)
  - 403 non-member
  - 201 successful bulk import
  - Transaction rollback on partial failure
  - Handles Blotato API failure

#### Phase 2: Frontend — Accounts Page Redesign

**2a. Add shadcn checkbox component**

```bash
npx shadcn@latest add checkbox
```

This adds `src/components/ui/checkbox.tsx` (uses Radix UI).

**2b. New component: `BlotatoSyncSection`** — `src/components/accounts/BlotatoSyncSection.tsx`

Inline section at the top of the accounts page showing available Blotato accounts.

States:
- **Loading**: Skeleton/spinner while fetching from `/api/accounts/available`
- **Error**: "Could not fetch available accounts from Blotato" with Refresh button. Already-imported cards still visible below.
- **Empty (no Blotato accounts)**: "No accounts found on Blotato" with steps to connect + "Go to Blotato" link + Refresh button
- **Empty (all imported)**: "All your Blotato accounts have been imported" with Refresh button
- **Available accounts**: Checklist with Select All + Import Selected (disabled when 0 selected)
- **Importing**: Import button shows spinner, checkboxes disabled

Each row: `[checkbox] [platform icon] [platform label] — @username`

Props:
```typescript
interface BlotatoSyncSectionProps {
  businessId: string;
  onImportComplete: () => void;  // triggers re-fetch of imported accounts
}
```

**2c. Update `AccountCard`** — `src/components/accounts/AccountCard.tsx`

- Remove the "Connect" button and `connectUrl` entirely
- Only render the connected state (platform icon, username, disconnect button)
- Keep platform styles and icons (reusable)

**2d. Redesign `AccountsPage`** — `src/app/dashboard/accounts/page.tsx`

- Replace hardcoded `PLATFORMS.map()` grid with actual imported accounts from `/api/accounts`
- Add `BlotatoSyncSection` above the account cards grid
- Show one card per imported account (not per platform) — handles multiple accounts per platform
- Remove URL parameter notification handling (no longer redirect-based)
- Use in-page `notification` state for success/error feedback
- Add loading state for initial account fetch

Layout:
```
<BlotatoSyncSection businessId={...} onImportComplete={refetch} />
<Separator />
<h2>Imported Accounts</h2>
<Grid of AccountCards for imported accounts>
  or "No imported accounts yet."
```

**2e. Extract platform icons/styles** — `src/components/accounts/platform-utils.ts`

Move `PLATFORM_STYLES`, `PLATFORM_ICONS`, and SVG icon components from `AccountCard.tsx` to a shared utility so `BlotatoSyncSection` can reuse them.

#### Phase 3: Cleanup

**3a. Remove old connect routes**

- Delete `src/app/api/connect/blotato/route.ts`
- Delete `src/app/api/connect/blotato/callback/route.ts`
- Delete `src/__tests__/api/connect/blotato-init.test.ts`
- Delete `src/__tests__/api/connect/blotato-callback.test.ts`

**3b. Update mock data** — `src/lib/mocks/blotato.ts`

Add TikTok and YouTube to `mockListAccounts()`, plus a second Twitter account for multi-account testing:

```typescript
export function mockListAccounts(): BlotatoAccount[] {
  return [
    { id: "mock-twitter-001", platform: "twitter", username: "mock_twitter_user" },
    { id: "mock-twitter-002", platform: "twitter", username: "mock_twitter_alt" },
    { id: "mock-instagram-001", platform: "instagram", username: "mock_insta_user" },
    { id: "mock-facebook-001", platform: "facebook", username: "Mock Facebook Page" },
    { id: "mock-tiktok-001", platform: "tiktok", username: "mock_tiktok_user" },
    { id: "mock-youtube-001", platform: "youtube", username: "Mock YouTube Channel" },
  ];
}
```

**3c. Remove URL param notification handling** from accounts page (replaced by in-page state).

## System-Wide Impact

- **Interaction graph**: Page load → `GET /api/accounts/available` → `listAccounts()` (Blotato API or mock) → filter against DB. Import → `POST /api/accounts/import` → `listAccounts()` → `prisma.$transaction()` → upsert `SocialAccount` rows.
- **Error propagation**: Blotato API failures surface as error banners on the page, not redirects. Import failures return 400/500 JSON with specific error messages.
- **State lifecycle risks**: Transaction-based import prevents orphaned partial imports. `blotatoAccountId` unique constraint prevents duplicate imports across businesses.
- **API surface parity**: The existing `DELETE /api/accounts` endpoint is unchanged. The old `GET /api/connect/blotato` is removed (replaced by available + import).

## Acceptance Criteria

- [ ] Available accounts fetched on page load and displayed as inline checklist
- [ ] Select All / deselect toggles all checkboxes
- [ ] Import Selected imports checked accounts and refreshes the page state
- [ ] Import button disabled when no accounts selected, shows spinner during import
- [ ] Already-imported accounts shown as platform cards with Disconnect
- [ ] One card per imported account (handles multiple per platform)
- [ ] "No accounts found on Blotato" empty state with link to blotato.com + Refresh
- [ ] "All accounts imported" state when checklist would be empty
- [ ] Error state when Blotato API is unreachable (imported cards still visible)
- [ ] Accounts claimed by other businesses are excluded from available list
- [ ] Mock mode returns expanded mock data (all 5 platforms + multi-account)
- [ ] Old connect routes removed (no dead code)
- [ ] All new endpoints have auth + membership checks
- [ ] Import uses DB transaction (all-or-nothing)
- [ ] Tests: available endpoint (8+ cases), import endpoint (7+ cases)
- [ ] Mobile responsive (matches existing responsive patterns)

## Dependencies & Risks

| Risk | Mitigation |
|------|-----------|
| Blotato API slow on page load | Loading state + imported cards shown independently |
| Blotato API rate limited (30 req/min for some endpoints) | `listAccounts()` is unlimited per docs; import re-fetches once |
| Multiple accounts per platform complicates card grid | One card per account, not per platform |
| `blotatoAccountId` unique constraint on cross-business import | Filter globally in available endpoint |
| shadcn checkbox install may need Radix UI dependency | Already using Radix via other shadcn components |

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-12-accounts-page-blotato-sync-ux-brainstorm.md](docs/brainstorms/2026-03-12-accounts-page-blotato-sync-ux-brainstorm.md) — Key decisions: sync model, inline selection, fetch on load, hide unsupported platforms
- **Blotato API docs:** https://help.blotato.com/api/llm — accounts endpoint, platform names
- **PR #45:** Fixed Blotato client to use real v2 API (base URL, auth header, request shapes)
- **Existing patterns:** `src/app/dashboard/posts/page.tsx` (client-side fetch with loading state), `src/app/api/accounts/route.ts` (auth + membership pattern)
- **SpecFlow gaps resolved:** businessId from session, global claim filtering, all-or-nothing transaction, re-validate on import
