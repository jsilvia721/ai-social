---
date: 2026-03-10
topic: media-generation-creative-profile
status: ready-for-planning
---

# Phase 1: Real Media Generation + Creative Profile

## What We're Building

Replace the stub image generator (1x1 transparent PNG) with real AI-generated images via Gemini Imagen 4, and add Creative Profile fields (accountType, visualStyle) to ContentStrategy so the AI adapts its visual output per workspace. Users validate image quality through a "Generate Image" button in the Post Composer before connecting real social accounts.

**Scope:** Images only. Video generation (Kling/Runway) deferred to a fast follow once image generation is proven in production.

## Why This Approach

**Gemini Imagen 4 over OpenAI gpt-image-1:**
- Same price point (~$0.04/image)
- Google AI API key is easy to provision (already have Google credentials for OAuth)
- Synchronous API — no async polling needed, keeps architecture simple
- Excellent quality for social media use cases

**Images first, video later:**
- Video adds significant complexity: async MediaJob model, polling cron, streaming downloads, Lambda memory bumps
- Image generation covers the majority of social media content (Instagram feed, Twitter, Facebook)
- Proves the Creative Profile → prompt → generation → upload pipeline end-to-end
- Video can be added as a fast follow with confidence once images work

**Minimal Creative Profile (accountType + visualStyle):**
- These two fields have the biggest impact on generation quality
- accountType (BUSINESS/INFLUENCER/MEME) drives tone and aesthetic fundamentally
- visualStyle (free text like "clean minimalist" or "chaotic meme energy") gives the AI specific direction
- colorPalette, referenceImageUrls, logoUrl deferred — can be added later without schema changes (just nullable fields)

**Validation via Post Composer:**
- Add "Generate Image" button to existing PostComposer UI
- Users see the AI-generated image inline before scheduling
- Uses existing upload/preview infrastructure
- No throwaway test pages needed

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Image provider | Gemini Imagen 4 | $0.04/image, sync API, easy to provision |
| Video generation | Deferred | Ship images first, add video as fast follow |
| Creative Profile fields | accountType + visualStyle only | Maximum impact, minimum schema change |
| Creative Profile location | Fields on ContentStrategy | Avoids join complexity (per existing plan) |
| Validation approach | "Generate Image" in Post Composer | Reuses existing UI, immediate visual feedback |
| Onboarding capture | Both wizard + strategy settings page | New workspaces get it during setup, existing workspaces edit in settings |
| Mock behavior | `shouldMockExternalApis()` guard | Returns current 1x1 PNG stub when mocked, real Gemini call in production |

## What's Changing

### Schema
- Add `accountType String @default("BUSINESS")` to ContentStrategy
- Add `visualStyle String? @db.Text` to ContentStrategy
- Migration required

### New Files
- `src/lib/providers/gemini.ts` — Gemini Imagen 4 integration
- `src/lib/providers/types.ts` — ImageProvider interface (lightweight, for future video provider)

### Modified Files
- `src/lib/media.ts` — dispatch to Gemini instead of mock
- `src/lib/ai/index.ts` — `generatePostContent()` receives Creative Profile context
- `src/lib/fulfillment.ts` — passes Creative Profile to image generation
- `src/env.ts` — add `GOOGLE_AI_API_KEY` (optional, mocked when absent)
- `sst.config.ts` — add `GoogleAiApiKey` secret + env var mapping
- `src/lib/strategy/schemas.ts` — add accountType/visualStyle to wizard + patch schemas
- `src/app/dashboard/businesses/[id]/onboard/page.tsx` — new wizard steps
- `src/app/api/businesses/[id]/onboard/route.ts` — handle new fields
- `src/components/posts/PostComposer.tsx` — "Generate Image" button
- Strategy settings page — editable accountType/visualStyle fields

### Not Changing (deferred)
- No MediaJob model (no async video)
- No media-poll cron
- No Kling/Runway integration
- No colorPalette, referenceImageUrls, logoUrl fields
- No provider registry/factory pattern

## Open Questions

*None — all key decisions resolved during brainstorm.*

## Supersedes

This brainstorm refines Phase 1 from `docs/brainstorms/2026-03-09-revised-platform-roadmap-brainstorm.md`, scoping it to images-only with minimal Creative Profile. Video generation (Phase 1.4 in the original plan) is deferred to a separate follow-up.
