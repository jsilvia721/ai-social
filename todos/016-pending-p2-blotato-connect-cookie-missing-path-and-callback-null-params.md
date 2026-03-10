---
status: complete
priority: p2
issue_id: "016"
tags: [code-review, security, oauth, typescript]
dependencies: []
---

# P2 — Blotato Connect Cookie Missing `path: "/"` + Callback Params Not Null-Checked

## Problem Statement

Two issues in the Blotato connect flow:

1. **State cookie missing `path: "/"`** — without it, the callback route at `/api/connect/blotato/callback` may not receive the cookie set at `/api/connect/blotato` in all browser/proxy configurations (path matching is narrower than the full route tree). Inconsistent with the existing Twitter/TikTok pattern which sets `path: "/"`.

2. **Callback `searchParams` not null-checked** — `searchParams.get()` returns `null` when parameters are absent. `blotatoAccountId`, `username`, and `platformId` can all be `null`, but they're passed directly to the Prisma `upsert` where `platformId = null` in the `where` unique constraint will either match nothing or create a row with `platformId = null`, violating schema intent. `platform` is cast with `as Platform` without validation — an unexpected platform string produces an invalid enum value silently.

## Findings

- Source: security-sentinel (P2-2), kieran-typescript-reviewer (Finding 8)
- Existing Twitter connect route at `src/app/api/connect/twitter/route.ts:27` sets `path: "/"` — Blotato must match this pattern
- `searchParams.get()` is typed as `string | null` — TypeScript will error on direct Prisma use if schema fields are non-nullable, but the plan adds `blotatoAccountId String` (non-nullable) which would cause a TypeScript error... unless `blotatoAccountId` is `String?` in the transition period (Release 1), masking the type error

## Proposed Solutions

### Fix 1 — Add `path: "/"` to state cookie
```typescript
cookieStore.set("blotato_oauth_state", JSON.stringify({ state, businessId, platform }), {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  maxAge: 300,
  path: "/",  // ADD THIS
});
```

### Fix 2 — Validate callback params with Zod
```typescript
const callbackSchema = z.object({
  account_id: z.string().min(1),
  username: z.string().min(1),
  platform_id: z.string().min(1),
  platform: z.nativeEnum(Platform),
  state: z.string().min(1),
});

const params = callbackSchema.safeParse(Object.fromEntries(searchParams));
if (!params.success) {
  return NextResponse.redirect(
    new URL("/dashboard/accounts?error=invalid_callback", req.url)
  );
}
const { account_id: blotatoAccountId, username, platform_id: platformId, platform } = params.data;
```

**Effort:** Small | **Risk:** Low

## Recommended Action

Both fixes in Phase 4 implementation.

## Technical Details

- **Affected files:** `src/app/api/connect/blotato/route.ts`, `src/app/api/connect/blotato/callback/route.ts`
- **Plan phase:** Phase 4

## Acceptance Criteria

- [ ] State cookie sets `path: "/"`
- [ ] Callback validates all `searchParams` with Zod before any DB operation
- [ ] Unknown `platform` value → redirect with `?error=invalid_callback`
- [ ] Missing required params → redirect with `?error=invalid_callback`
- [ ] Test: callback with missing `account_id` → redirect error

## Work Log

- 2026-03-07: Identified by security-sentinel (P2-2) and kieran-typescript-reviewer (Finding 8) during plan review
