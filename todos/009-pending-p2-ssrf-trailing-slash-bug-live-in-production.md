---
status: pending
priority: p2
issue_id: "009"
tags: [code-review, security, ssrf, fix-immediately]
dependencies: []
---

# P2 — SSRF Trailing-Slash Bug is LIVE in Production; Twitter Has No Guard

## Problem Statement

The plan correctly identifies the SSRF trailing-slash fix but defers it to the new `src/lib/blotato/ssrf-guard.ts`. The existing code has the bug live in production today:

1. `src/lib/platforms/ssrf-guard.ts` uses `url.startsWith(allowedPrefix)` without appending a `/` — allows `https://storage.example.com.attacker.com/evil.jpg` to pass if `AWS_S3_PUBLIC_URL = https://storage.example.com`
2. `src/lib/platforms/twitter/index.ts` has `fetch(url)` with **no SSRF guard at all** on `uploadTwitterMedia`

These bugs remain live during Release 1 and Release 2 while the old platform code still runs.

## Findings

- Source: security-sentinel (P2-1)
- The plan fixes SSRF in the new `src/lib/blotato/ssrf-guard.ts` but the old guard has the bug
- Twitter's `uploadTwitterMedia` confirmed to have no guard at all — raw `fetch(url)` call
- Fix is one line per file — there is no reason to defer this

## Proposed Solutions

### Fix Now (Recommended — before Phase 1 starts)

**File 1: `src/lib/platforms/ssrf-guard.ts`**
```typescript
// WRONG (current):
if (!url.startsWith(env.AWS_S3_PUBLIC_URL)) { ... }

// CORRECT:
const allowedPrefix = env.AWS_S3_PUBLIC_URL.endsWith("/")
  ? env.AWS_S3_PUBLIC_URL
  : `${env.AWS_S3_PUBLIC_URL}/`;
if (!url.startsWith(allowedPrefix)) { ... }
```

**File 2: `src/lib/platforms/twitter/index.ts`**
```typescript
// Add before any fetch(url) in uploadTwitterMedia:
assertSafeMediaUrl(url);
```

**File 3: `src/app/api/posts/route.ts` and `src/app/api/posts/[id]/route.ts`**
```typescript
// In POST /api/posts and PATCH /api/posts/[id] when mediaUrls is present:
mediaUrls.forEach(assertSafeMediaUrl);
```

**Effort:** Small | **Risk:** Low | **Do this in a separate hotfix commit before Phase 1**

## Recommended Action

Apply in a standalone hotfix PR before starting M1 migration work. This is production-live security bug, not a plan gap.

## Technical Details

- **Affected files:** `src/lib/platforms/ssrf-guard.ts`, `src/lib/platforms/twitter/index.ts`, `src/app/api/posts/route.ts`, `src/app/api/posts/[id]/route.ts`
- **Plan phase:** Pre-Phase 1 hotfix

## Acceptance Criteria

- [ ] `src/lib/platforms/ssrf-guard.ts` uses trailing-slash guard
- [ ] `uploadTwitterMedia` calls `assertSafeMediaUrl(url)` before `fetch(url)`
- [ ] `POST /api/posts` validates `mediaUrls` with `forEach(assertSafeMediaUrl)`
- [ ] `PATCH /api/posts/[id]` validates `mediaUrls` when present in update payload
- [ ] Test: URL `https://storage.example.com.attacker.com/evil.jpg` fails the guard

## Work Log

- 2026-03-07: Identified by security-sentinel (P2-1) during plan review
