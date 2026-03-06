---
status: pending
priority: p2
issue_id: "009"
tags: [code-review, architecture, tokens]
dependencies: []
---

# token.ts: Implicit fallthrough to TikTok branch for unknown platforms

## Problem Statement

`src/lib/token.ts` uses a comment `// TIKTOK` to mark the final `else` branch of the platform refresh chain. Any unknown platform (e.g., a newly added platform) silently falls through to the TikTok token refresh path, producing a misleading 401 error rather than a clear "unsupported platform" exception.

## Findings

- **File:** `src/lib/token.ts:52-62`
- Related to scheduler issue (006) — both should have exhaustive platform guards
- Confirmed by: TypeScript Reviewer, Architecture Strategist

## Proposed Solutions

### Option A: Exhaustive if/else chain with explicit error
```ts
} else if (platform === "TIKTOK") {
  // refresh tiktok
} else {
  throw new Error(`Token refresh not supported for platform: ${platform}`)
}
```
- Effort: Very Small | Risk: None

## Recommended Action

Apply Option A.

## Technical Details

- **Affected files:** `src/lib/token.ts`

## Acceptance Criteria

- [ ] Unknown platform throws explicit error in `ensureValidToken`
- [ ] TikTok branch is explicitly guarded by `else if (platform === "TIKTOK")`

## Work Log

- 2026-03-06: Identified by TypeScript Reviewer. Flagged P2.

## Resources

- PR #1: feat/milestone-1-platform-connect
