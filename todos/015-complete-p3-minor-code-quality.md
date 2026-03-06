---
status: pending
priority: p3
issue_id: "015"
tags: [code-review, typescript, quality]
dependencies: []
---

# Minor code quality issues (batch)

## Problem Statement

Several small code quality issues identified during review. Each is straightforward to fix in one pass.

## Findings

### P3-001: Spurious eslint-disable comments
- **File:** `src/app/dashboard/posts/page.tsx:48,63`
- `// eslint-disable-next-line react-hooks/set-state-in-effect` — this rule does not exist in `@eslint/react-hooks`; comments are no-ops and should be removed

### P3-002: `process.env.X!` instead of validated `env.X`
- **File:** `src/lib/platforms/tiktok/index.ts:15-16`, `src/lib/platforms/youtube/index.ts` (similar)
- Should use `import { env } from "@/env"` and `env.TIKTOK_CLIENT_ID` for startup-time validation

### P3-003: Static multipart boundary in YouTube upload (correctness bug)
- **File:** `src/lib/platforms/youtube/index.ts:75`
- `const boundary = "boundary_ai_social"` — if the video binary contains this byte sequence, the multipart body is malformed (RFC 2046)
- Fix: `const boundary = crypto.randomUUID().replace(/-/g, "")`

### P3-004: YouTube `description` param misleadingly doubles as title
- **File:** `src/lib/platforms/youtube/index.ts:35-38`
- Parameter named `description` but first line is extracted as video title
- Rename to `content` or accept separate `title`/`description` params

### P3-005: Calendar server range uses local server timezone
- **File:** `src/app/api/posts/calendar/route.ts:20-21`
- `new Date(year, month, 1)` uses server local TZ — use `Date.UTC(year, month, 1)` (covered in more detail in todo 014)

### P3-006: OAuth callback code duplication
- TikTok and YouTube callback routes share near-identical patterns for CSRF check, token exchange, and account upsert
- Extract a shared `handleOAuthCallback` helper

## Proposed Solutions

Fix each item individually during a cleanup pass. P3-003 is technically a correctness bug and should be prioritized within P3.

## Acceptance Criteria

- [ ] Spurious eslint-disable comments removed from posts/page.tsx
- [ ] `process.env.X!` replaced with `env.X` in platform clients
- [ ] YouTube multipart boundary is generated randomly per request
- [ ] YouTube publish function param named `content` (or split into title/description)
- [ ] Calendar range uses `Date.UTC()`

## Work Log

- 2026-03-06: Identified by TypeScript Reviewer, Code Simplicity Reviewer. Flagged P3.

## Resources

- PR #1: feat/milestone-1-platform-connect
