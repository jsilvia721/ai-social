---
status: complete
priority: p2
issue_id: "039"
tags: [code-review, security, input-validation, fulfillment-engine]
dependencies: []
---

# PATCH /api/posts/[id] Missing Zod Body Validation

## Problem Statement

The PATCH endpoint destructures `content`, `scheduledAt`, and `mediaUrls` directly from `req.json()` without Zod schema validation. Content can be set to empty string or non-string types, and `mediaUrls` set to a non-array causes runtime crash. No length limits on content.

## Findings

- `src/app/api/posts/[id]/route.ts` line 34: `const { content, scheduledAt, mediaUrls } = await req.json()`
- `assertSafeMediaUrl` validates URLs but only if `mediaUrls?.length` is truthy
- Compare: `src/app/api/businesses/[id]/strategy/route.ts` correctly uses Zod validation

## Proposed Solutions

### Option A: Add Zod schema (Recommended)
```typescript
const PatchPostSchema = z.object({
  content: z.string().min(1).max(10000).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  mediaUrls: z.array(z.string().url()).optional(),
});
```
- Effort: Small (15 min)

## Acceptance Criteria

- [ ] PATCH body validated with Zod schema
- [ ] Invalid inputs return 400 with details
- [ ] Existing PATCH tests still pass

## Work Log

- 2026-03-08: Created from code review
