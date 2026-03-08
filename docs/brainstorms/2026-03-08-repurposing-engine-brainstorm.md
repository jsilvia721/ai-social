---
date: 2026-03-08
topic: repurposing-engine
---

# Repurposing Engine

## What We're Building

A content repurposing pipeline that takes a single piece of source content and automatically generates platform-native adapted versions for all connected social accounts. It operates as a core pipeline stage between content briefs and publishing — not just a UI feature.

Two entry points, same engine:
1. **Automated** — the weekly content briefs pipeline feeds source content in; the repurposing engine fans it out to all connected platforms automatically
2. **Manual** — a user pastes/writes source content in the composer and triggers a one-click fan-out

The human-in-the-loop is the existing review queue (briefs page with PENDING status). The autonomous path just works end-to-end; humans intervene only on exceptions.

## Why This Approach

**Problem:** Today, content gets created (often via external AI tools) and then manually copy-pasted and adapted per platform. This is the single biggest time sink in the workflow.

**Approaches considered:**
- **Composer-only UI enhancement** — rejected because it doesn't serve the autonomous pipeline. It would be a dead-end when the briefs pipeline is generating content automatically.
- **Post-publish repurposing** — rejected as primary path. Content performs best when platform-native from the start, not retrofitted after publishing.
- **Pipeline stage (chosen)** — repurposing as a stage between brief generation and review. Works for both automated and manual flows. The existing review queue provides human oversight without requiring new UI.

## Key Decisions

- **All connected platforms by default**: When repurposing triggers, it generates variants for every connected account in the workspace. The AI can flag (but not auto-skip) platforms where the content is a poor fit — the human decides during review.
- **Platform-native adaptation**: Each variant is written natively for the platform (Twitter: punchy + concise, Instagram: longer + emojis + hashtags, Facebook: conversational, TikTok: casual + trending hashtags, YouTube: keyword-rich descriptions). Leverages existing platform guides in `generatePostContent()`.
- **Text-only repurposing to start**: The engine adapts caption/copy. Media carries over as-is where compatible, omitted where it's not. No media generation or format transformation yet.
- **Format recommendations in the data model**: Each variant stores an AI-suggested format (TEXT, IMAGE, CAROUSEL, VIDEO) even though we don't act on it yet. This preserves the upgrade path to media-aware repurposing without over-building.
- **Single AI call per fan-out**: One Claude call generates all platform variants at once (structured tool use with Zod validation), rather than N separate calls. More efficient and produces more coherent cross-platform messaging.
- **Source content is free-form**: The engine accepts any input — rough ideas, pasted articles, talking points, fully-written posts, or existing posts from the DB. The AI infers intent and adapts.

## Architecture Sketch

```
Source Content (brief or manual input)
        │
        ▼
┌─────────────────────┐
│  Repurposing Engine  │  src/lib/ai/repurpose.ts
│  (Claude call)       │
│                      │
│  Input: source text, │
│  connected platforms,│
│  content strategy    │
│                      │
│  Output: N variants  │
│  (one per platform)  │
└─────────────────────┘
        │
        ▼
   N Post records created
   (status: PENDING_REVIEW or DRAFT)
        │
        ▼
   Review Queue (existing briefs UI)
   or PostComposer (manual flow)
        │
        ▼
   Approve → SCHEDULED → publish cron
```

### Integration points:
- **Briefs pipeline** (`src/lib/briefs.ts`): After generating a brief, call repurposing engine to fan out across platforms. Creates Post records linked to the brief.
- **PostComposer** (`src/components/posts/PostComposer.tsx`): Add "Repurpose to all platforms" button. Generates variants inline, user reviews each tab, schedules all at once.
- **API**: New `POST /api/posts/repurpose` endpoint — accepts source content + optional platform overrides, returns N draft posts.
- **AI module**: New `repurposeContent()` function in `src/lib/ai/repurpose.ts` — single Claude call with structured tool use, returns platform-keyed variants with format recommendations.

### Data model:
- Posts created by repurposing share a `repurposeGroupId` (new nullable field on Post) so the UI can display them as a cohesive set.
- Each variant stores `suggestedFormat` (TEXT/IMAGE/CAROUSEL/VIDEO) for future media-aware upgrades.

## Open Questions

- **Scheduling strategy for variants**: Should all platform variants go out at the same time, or stagger based on optimal times per platform? (Probably stagger using existing `suggestOptimalTimes()`, but confirm during planning.)
- **Brief-to-multi-post mapping**: Currently one brief = one post. Repurposing means one brief = N posts. Need to decide if we keep the 1:1 `briefId` FK on Post or add a junction table. (Probably keep 1:1 and just set `briefId` on all variants — simple, and the `repurposeGroupId` handles grouping.)
- **Review UX for variant sets**: The existing briefs queue shows individual items. Should repurposed sets appear as a grouped card (approve/reject all) or individual items? (Leaning toward grouped card for efficiency.)

## Next Steps

-> `/ce:plan` for implementation details
