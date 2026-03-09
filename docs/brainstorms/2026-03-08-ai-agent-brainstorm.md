# Phase 2.1: AI Agent — Brief Fulfillment Engine

**Date:** 2026-03-08
**Status:** Ready for planning

## What We're Building

An AI agent that automatically fulfills ContentBriefs into fully-formed posts (text + media), routes them through a configurable human review process, and schedules approved posts for publishing. This completes the autonomous content pipeline: Research → Briefs → **Agent Fulfillment** → Review → Publish.

### Core Components

1. **Daily Fulfillment Cron** — Runs daily, picks up pending ContentBriefs, generates post content + media, creates Posts in `PENDING_REVIEW` status
2. **Pluggable Media Generation** — Interface for text-to-image and text-to-video generation; provider chosen at implementation time (Gemini, OpenAI, Replicate, etc.)
3. **Review Queue UI** — Dedicated `/dashboard/review` page showing all PENDING_REVIEW posts. Approve, reject, or edit. Badge count in sidebar.
4. **Approval API** — Endpoints to approve (→ SCHEDULED) or reject PENDING_REVIEW posts
5. **Auto-Approval Logic** — For businesses using review-window mode: transitions PENDING_REVIEW → SCHEDULED after `reviewWindowHours` expires without rejection. Can run inside the existing publisher cron (every 1min) rather than a separate Lambda.
6. **Business-Level Approval Config** — Each business chooses: explicit approval required OR auto-approve with review window (N hours)

## Why This Approach

**Brief Fulfillment Agent** was chosen over a fully autonomous loop because:

- The content intelligence pipeline (research → briefs → optimization) already exists and runs on crons
- ContentBriefs have ready-to-use captions, platform targeting, format recommendations, and `aiImagePrompt` fields
- Schema already has `PENDING_REVIEW` status, `reviewWindowExpiresAt`, and `reviewWindowHours` — just needs wiring
- Incremental build on proven infrastructure rather than replacing it
- Better transparency: briefs explain *why* content was chosen, making the agent's decisions auditable

## Key Decisions

### 1. Approval Flow: Configurable per Business (Two Modes)
- **Explicit approval** — Posts stay in PENDING_REVIEW until manually approved. Nothing publishes without human action.
- **Auto-approve with review window** — Posts auto-transition to SCHEDULED after N hours (default 24h from ContentStrategy.reviewWindowHours) unless rejected. Human always has a chance to intervene.
- No fully autonomous mode — always a human touchpoint.

### 2. Media: Full Generation (Text + Image + Video)
- Agent generates media for posts using the `aiImagePrompt` and `recommendedFormat` fields from ContentBriefs
- Pluggable provider interface — design the abstraction now, choose provider(s) during implementation
- Provider candidates: Gemini Imagen, OpenAI DALL-E/Sora, Replicate (Flux/open models)

### 3. Timing: Daily Fulfillment
- Agent cron runs daily, fulfills briefs whose `scheduledFor` falls within the next 48 hours
- Spreads work out (vs. weekly batch), making review manageable
- Pairs well with the existing weekly brief generation (Sunday) and daily publishing cadence

### 4. Cross-Platform: Smart Mix
- ContentBriefs already target specific platforms via the `platform` field
- Some content is inherently platform-specific (TikTok video, Twitter thread) — agent creates as-is
- Other content can be adapted across platforms — agent uses existing repurpose engine when appropriate
- The `generateBriefs` function already plans per-platform, so brief-level targeting is the primary mechanism

### 5. Review UX: Dedicated Queue
- New `/dashboard/review` page with all PENDING_REVIEW posts
- Approve, reject, or edit-in-place for each post
- Badge count in sidebar showing number of posts awaiting review
- Mobile-responsive (consistent with existing mobile-first approach)

## Existing Infrastructure to Leverage

| Component | Status | What It Does |
|---|---|---|
| `ContentBrief` model | Built | Has topic, caption, aiImagePrompt, platform, format, scheduledFor |
| `PENDING_REVIEW` status | In schema, not wired | Post status enum value exists |
| `reviewWindowExpiresAt` | In schema, not wired | Field on Post model |
| `reviewWindowEnabled/Hours` | In schema, not wired | Fields on ContentStrategy |
| Research cron (every 4h) | Running | Fetches RSS/Reddit/Trends, synthesizes themes |
| Briefs cron (weekly) | Running | Generates weekly ContentBriefs |
| Optimizer cron (weekly) | Running | Analyzes performance, adjusts strategy |
| Scheduler (every 1min) | Running | Publishes SCHEDULED posts via Blotato |
| Repurpose engine | Built | Generates platform-native variants |
| `generatePostContent()` | Built | Claude-based text generation |

## Resolved Questions

1. **Media provider selection** — Defer to implementation. Design a pluggable interface; choose provider(s) based on cost/quality evaluation during build.
2. **Media storage** — Server-side upload via existing `uploadFile()` in `src/lib/storage.ts`. Agent cron downloads generated media and uploads directly to S3.
3. **Brief-to-post content enhancement** — Use brief captions as-is. They're already AI-generated with platform and strategy context. Avoids redundant AI calls and cost.
4. **Rejection handling** — Cancel the brief (mark as CANCELLED), move post to DRAFT. User can manually edit the draft if they want, or it's simply skipped.
5. **Rate limiting / cost controls** — Configurable daily cap per business (default ~5 posts/day), stored in ContentStrategy. Prevents runaway API costs for media generation. When more briefs are due than the cap allows, prioritize by `sortOrder` (set during brief generation based on content strategy).

## Open Questions

None — all deferred decisions (media provider selection) are intentionally left to implementation time.
