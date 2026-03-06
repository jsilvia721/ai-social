---
status: pending
priority: p2
issue_id: "010"
tags: [code-review, typescript, tiktok, youtube]
dependencies: []
---

# Unguarded `as string` casts on untyped API responses (YouTube silent corruption)

## Problem Statement

`publishYouTubeVideo` at line 110 casts `data.id as string` with no null guard. If `data.id` is missing (API error, schema change), `videoId` becomes `undefined` cast to `string`, producing `"https://www.youtube.com/watch?v=undefined"` stored in the database — a silently corrupt return value. TikTok has a guard (`if (!publishId)`) but the cast is still wrong form.

## Findings

- **File:** `src/lib/platforms/youtube/index.ts:110`, `src/lib/platforms/tiktok/index.ts:123`
- `data` is typed `any` (from `res.json()`); casts succeed unconditionally
- YouTube has NO null guard after the cast — corrupt URL gets persisted
- Confirmed by: TypeScript Reviewer

## Proposed Solutions

### Option A: Zod schema for API responses (Recommended)
```ts
const YouTubeUploadResponse = z.object({ id: z.string() })
const parsed = YouTubeUploadResponse.safeParse(data)
if (!parsed.success) throw new Error(`Unexpected YouTube response: ${JSON.stringify(data)}`)
const videoId = parsed.data.id
```
- Pros: Type-safe, clear error on unexpected response
- Effort: Small | Risk: None

### Option B: Manual type narrowing
```ts
const videoId = typeof data?.id === "string" ? data.id : null
if (!videoId) throw new Error(...)
```
- Pros: No Zod dependency
- Effort: Very Small | Risk: None

## Recommended Action

Option A — Zod schemas for platform API responses. Apply consistently to TikTok, YouTube, and token exchange responses.

## Technical Details

- **Affected files:** `src/lib/platforms/youtube/index.ts`, `src/lib/platforms/tiktok/index.ts`
- Also affects OAuth callbacks (covered in todo 011)

## Acceptance Criteria

- [ ] `data.id` on YouTube response is validated before use
- [ ] Missing `data.id` throws a descriptive error (not stored as "...undefined")
- [ ] TikTok `publish_id` similarly validated

## Work Log

- 2026-03-06: Identified by TypeScript Reviewer. Flagged P2.

## Resources

- PR #1: feat/milestone-1-platform-connect
