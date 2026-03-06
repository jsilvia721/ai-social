---
status: pending
priority: p1
issue_id: "006"
tags: [code-review, architecture, scheduler, youtube]
dependencies: []
---

# Scheduler: Unguarded else branch silently routes unknown platforms to YouTube

## Problem Statement

The scheduler's platform dispatch contains an unguarded `else` that falls through to the YouTube publish path for any platform not explicitly handled. If a new platform is added to the Prisma schema but not to the scheduler dispatch, its posts will silently publish via the YouTube API, producing confusing errors. This is a silent failure mode — no exception is thrown, no error is logged at the routing level.

## Findings

- **File:** `src/lib/scheduler.ts` (or similar platform dispatch logic)
- The pattern `if (platform === "TWITTER") { ... } else if (platform === "INSTAGRAM") { ... } else { publishYouTube() }` silently routes anything to YouTube
- Confirmed by: Architecture Strategist (flagged as P1)

## Proposed Solutions

### Option A: Exhaustive switch with default throw (Recommended)
```ts
switch (account.platform) {
  case "TWITTER": return publishTwitter(...)
  case "INSTAGRAM": return publishInstagram(...)
  case "FACEBOOK": return publishFacebook(...)
  case "TIKTOK": return publishTikTok(...)
  case "YOUTUBE": return publishYouTube(...)
  default: throw new Error(`Unsupported platform: ${account.platform satisfies never}`)
}
```
- `satisfies never` provides a compile-time exhaustiveness check
- Pros: TypeScript will error at compile time if a platform is added to the enum but not the switch
- Effort: Small | Risk: Low

### Option B: Dispatch object/record
```ts
const dispatch: Record<Platform, (...)=> Promise<void>> = {
  TWITTER: publishTwitter,
  ...
}
const fn = dispatch[account.platform]
if (!fn) throw new Error(...)
```
- Pros: Clean, type-safe, easy to add platforms
- Effort: Small | Risk: Low

## Recommended Action

Option A (switch + `satisfies never`). Most explicit and gives compile-time guarantees.

## Technical Details

- **Affected files:** `src/lib/scheduler.ts`
- Should also fix `src/lib/token.ts` implicit TikTok fallthrough (see P2-004)

## Acceptance Criteria

- [ ] Unknown platform throws a clear error rather than routing to YouTube
- [ ] TypeScript exhaustiveness check prevents silent misrouting at compile time
- [ ] Adding a new Platform enum value causes a compile error in the scheduler until handled

## Work Log

- 2026-03-06: Identified by Architecture Strategist. Flagged P1.

## Resources

- PR #1: feat/milestone-1-platform-connect
