---
status: pending
priority: p2
issue_id: "011"
tags: [code-review, typescript, oauth, tiktok, youtube]
dependencies: []
---

# OAuth token exchange responses are untyped `any` — no schema validation

## Problem Statement

TikTok and YouTube OAuth callback routes destructure `tokenData` (from `res.json()`) with no type validation. Fields like `access_token`, `refresh_token`, `expires_in`, `open_id` are all implicitly `any`. If the provider changes its response shape, a corrupt/missing value silently gets stored in the database without a clear error.

## Findings

- **File:** `src/app/api/connect/tiktok/callback/route.ts:77-92`, `src/app/api/connect/youtube/callback/route.ts:60-88`
- All destructured token fields are `any` — `as string` / `as number` casts are no-ops
- Confirmed by: TypeScript Reviewer

## Proposed Solutions

### Option A: Zod schema validation on token response
```ts
const TikTokTokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
  open_id: z.string(),
})
const tokenData = TikTokTokenSchema.parse(await res.json())
```
- Throws clearly if shape is wrong; fields are properly typed
- Effort: Small | Risk: None

## Recommended Action

Apply Option A to TikTok and YouTube callback routes. Reuse pattern across all OAuth callbacks.

## Technical Details

- **Affected files:** `src/app/api/connect/tiktok/callback/route.ts`, `src/app/api/connect/youtube/callback/route.ts`

## Acceptance Criteria

- [ ] Token exchange responses validated with Zod before destructuring
- [ ] Invalid/unexpected token responses throw a descriptive error (not stored silently)
- [ ] All `as string` / `as number` casts on token fields removed

## Work Log

- 2026-03-06: Identified by TypeScript Reviewer. Flagged P2.

## Resources

- PR #1: feat/milestone-1-platform-connect
