---
date: 2026-03-09
topic: revised-platform-roadmap
status: ready-for-planning
---

# Revised Platform Roadmap — Vision Recalibration

## What We're Building

A fully autonomous AI social media platform that manages a portfolio of 2-3 brands across Instagram and TikTok (primary), with support for Twitter, Facebook, and YouTube (secondary). The platform handles the entire content lifecycle — research, content generation (text + images + video), scheduling, publishing, performance analysis, and strategy optimization — with minimal human involvement.

**Key differentiator:** The platform adapts to fundamentally different account types within the same system:
- **Business/service accounts** — polished, brand-consistent, educational/promotional content
- **Influencer-style accounts** — personality-driven, curated aesthetic, storytelling
- **Meme/viral accounts** — high volume, trend-reactive, humor-driven, speed over polish

Each workspace has its own Creative Profile, content strategy, posting cadence, and autonomy settings. The same AI engine adapts its research, generation, and optimization behavior based on the account type.

### Operating Philosophy

**Start light-touch, graduate to autonomous.** Every workspace begins with human review of AI-generated posts. As confidence in output quality builds, workspaces can be switched to auto-approve or fully autonomous mode. The review queue is a training-wheels feature, not a permanent workflow.

**Dog-food first, productize later.** This is for Josh + business partner's own brands. If it works well, the multi-workspace architecture already supports onboarding external clients without code changes.

---

## Current State (What's Already Built)

### Fully Operational
- Multi-workspace model (Business, BusinessMember, ContentStrategy)
- Blotato unified publishing to all 5 platforms
- Research pipeline (4-hour cron: RSS, Reddit, Google Trends → Claude synthesis)
- Weekly content brief generation (Sunday cron)
- Brief fulfillment engine (6-hour cron, creates posts from briefs)
- Content repurposing (single source → platform-native variants)
- Human review workflow (PENDING_REVIEW → approve/reject, auto-approval on window expiry)
- Weekly strategy optimizer (Claude analyzes performance → adjusts format mix, cadence, topics)
- Strategy digest/insights page
- Content strategy settings UI (in PR)
- Post composer with AI text generation
- Calendar views (month + week, drag-to-reschedule)
- Email notifications (SES: brief digest, review alerts, failure alerts)
- Mobile-responsive dashboard
- E2E test suite (Playwright)
- Mock API layer for dev/staging

### Stub/Placeholder
- **Media generation** — `generateImage()` returns a 1x1 transparent PNG. No real provider wired.
- **Brand/creative assets** — no model, no storage, no UI

### Not Started
- Production environment (no custom domain, no prod SST stage)
- Real image generation provider
- Video generation
- Reactive/trend-driven pipeline
- Creative Profile model
- In-app notifications
- Richer analytics (time-series, engagement trends)
- Content library (save winning patterns)

### Tech Debt
- 2 partially-fixed P1 bugs (blotatoAccountId unique constraint, CI DIRECT_URL)
- 18 P2 issues (missing indexes, auth gaps, test coverage)
- 15 P3 issues (dead code, simplification opportunities)

---

## What We're Scrapping

These were in the original brainstorms but are no longer planned:

| Feature | Reason |
|---------|--------|
| Thompson Sampling / bandit system | Claude optimizer is sufficient. Formal bandit adds complexity without proportional value at our scale. |
| Pluggable AI module registry | Over-engineered. We'll integrate providers directly and swap them when better ones ship. |
| Client portal (read-only workspace view) | Not needed for own brands. Multi-workspace already supports future clients. |
| Transfer learning across workspaces | Premature. Each brand is distinct enough that shared posteriors don't help. |
| LoRA fine-tuning for brand images | Too early. Standard prompting with Creative Profile context is the starting point. |
| Campaign mode | Nice-to-have. The brief + strategy system already handles themed content through content pillars. |
| Tokenized client upload portal | Not needed when we're the clients. Standard composer upload works. |
| SMS notifications | Email + in-app is sufficient for 2 users. |

---

## Revised Milestone Structure

### Phase 0: Production-Ready (Week 1-2)

**Goal:** Infrastructure you can trust with real brand accounts.

**Deliverables:**
- Fix 2 remaining P1 bugs:
  - Add `@@unique([blotatoAccountId])` to SocialAccount schema + migration
  - Wire `DIRECT_URL` env var properly in `prisma.config.ts` and CI
- Set up production SST stage:
  - Custom domain (ACM cert, Route53/DNS)
  - Production database (Neon, separate from staging)
  - All 16 SST secrets configured for prod stage
  - SES verified sender domain for production email
- Fix highest-impact P2s:
  - Missing database indexes (BusinessMember, SocialAccount, Post)
  - Review page membership check
  - Strategy PATCH owner check
- Verify end-to-end flow works in staging with real Blotato API (disable mocks, connect a test account, publish a real post)

**Exit criteria:** `sst deploy --stage production` succeeds. A post can be manually composed, scheduled, and published to a real platform account in production.

---

### Phase 1: Real Media Generation (Week 2-3)

**Goal:** Every AI-generated post includes a real visual — image or video.

**Image Generation:**
- Integrate Gemini Imagen (or gpt-image-1 — evaluate during implementation)
- Replace `generateImage()` stub in `src/lib/media.ts` with real provider call
- AI image prompts informed by Creative Profile (style, colors, aesthetic)
- Generated images uploaded to S3 via existing `uploadBuffer()`
- SSRF guard applies (only S3 URLs passed to Blotato)

**Video Generation:**
- Integrate Kling or Runway for short-form video (15-60 seconds)
- ContentBrief `recommendedFormat` field already supports VIDEO — wire it through fulfillment
- Video uploaded to S3, passed to Blotato for Instagram Reels / TikTok
- Longer generation times handled async (generate → upload → schedule, not blocking)

**Creative Profile Model:**
- New `CreativeProfile` model (or extend ContentStrategy) per workspace:
  - `accountType`: BUSINESS | INFLUENCER | MEME
  - `visualStyle`: free text ("clean minimalist", "chaotic meme energy", "warm lifestyle")
  - `colorPalette`: string[] (hex codes, optional)
  - `referenceUrls`: string[] (example posts/accounts to emulate)
  - `logoUrl`: string? (S3 ref, optional — not relevant for meme accounts)
- AI generation prompts incorporate Creative Profile context
- Onboarding wizard updated to capture Creative Profile fields

**Exit criteria:** Fulfilled briefs produce posts with real AI-generated images. Video generation works for at least one format (short-form). Creative Profile influences visual output.

---

### Phase 2: Reactive Pipeline + Operations Polish (Week 3-4)

**Goal:** Meme/viral accounts can ride trends in near-real-time. Daily operations feel smooth for both users.

**Reactive Content Pipeline:**
- When research cron detects a trending topic matching a workspace's niche + account type:
  - Auto-generate a brief + fulfill it immediately (skip weekly batch)
  - Post status determined by workspace config:
    - `reactiveAutoPublish: true` → SCHEDULED immediately (meme accounts)
    - `reactiveAutoPublish: false` → PENDING_REVIEW (default, business/influencer accounts)
  - Push notification to review queue if review is required
- Research cron already runs every 4 hours — add trend-match scoring and reactive brief generation as a second pass after synthesis
- Rate limit: max N reactive posts per workspace per day (configurable, default 3)

**Review Queue UX Polish:**
- In-app notification badge (already exists in sidebar) — ensure it updates in real-time or on short poll
- One-tap approve/reject from mobile
- Batch approve (approve all pending for a workspace)
- Show AI's reasoning: why this topic, why this format, expected performance

**Analytics Improvements:**
- Date range filtering on analytics page
- Engagement rate over time (line chart)
- Best performing content types breakdown
- Per-platform performance comparison

**Notification Upgrades:**
- In-app notification center (replace email-only)
- Configurable: which events trigger notifications (new posts for review, publish failures, weekly digest)

**Exit criteria:** A meme account workspace auto-generates and publishes trend-reactive content within the 4-hour research cycle. Review queue supports efficient batch workflows. Analytics show trends over time.

---

### Phase 3: Toward Full Autonomy (Post-launch, ongoing)

**Goal:** Workspaces can run for weeks without human intervention, with measurably improving performance.

**Autonomy Features:**
- Per-workspace autonomy level setting:
  - `light_touch` — all posts go through review (default for new workspaces)
  - `auto_approve` — posts auto-publish after review window, human can intervene
  - `fully_autonomous` — posts publish immediately, no review step
- Graduated trust: platform tracks approval rate per workspace. If 95%+ of posts are approved over 2 weeks, suggest upgrading autonomy level.

**Scheduling Intelligence:**
- Analyze actual engagement data per platform per workspace to learn optimal posting times
- Replace static `suggestOptimalTimes()` with data-driven recommendations
- Factor in audience timezone distribution (from platform analytics if available)

**Content Library:**
- Save top-performing post patterns (topic + format + tone combinations)
- AI references content library when generating new briefs ("posts like X performed well, create more in this style")
- Manual curation: mark posts as "template" to influence future generation

**Model Upgrade Path:**
- Abstract AI provider calls behind interfaces so swapping Claude → newer model, or Gemini Imagen → better image model, is a config change not a rewrite
- Track which AI model generated each post for A/B comparison across model versions

**Exit criteria:** At least one workspace runs fully autonomous for 2+ weeks with stable or improving engagement metrics.

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary platforms | Instagram + TikTok | Highest engagement potential for visual/video content. Other platforms secondary. |
| Account types | Business, Influencer, Meme — via Creative Profile | Same engine, different behavior. Avoids building separate systems. |
| Content generation | 100% AI-generated (text + images + video) | The whole point. Human assets are a fallback, not the default path. |
| Media providers | Gemini/OpenAI for images, Kling/Runway for video | Evaluate during implementation. Direct integration, no pluggable registry. |
| Trend response | Reactive pipeline (auto-generate on trend match) | Meme accounts need speed. Weekly batch is too slow for viral content. |
| Reactive auto-publish | Configurable per workspace | Meme accounts opt into speed. Business accounts keep review gate. |
| Autonomy model | Graduated: light-touch → auto-approve → fully autonomous | Build trust incrementally. Start reviewing, graduate to hands-off. |
| Creative Profile vs Brand Kit | Creative Profile | Works for meme accounts (no logo/brand colors) and business accounts alike. Flexible concept. |
| Optimization approach | Claude analyzer (no bandit) | Weekly Claude analysis of performance patterns. Simpler, sufficient at our scale. |
| Scrapped features | Bandit, client portal, module registry, LoRA, campaigns, transfer learning | YAGNI. These add complexity without proportional value for 2-3 self-managed brands. |
| Production timeline | ~1 month to real posting | Phase 0-1 in 2 weeks, Phase 2 in 2 more weeks. Phase 3 is ongoing. |
| Dog-food first | Own brands, then potentially productize | Multi-workspace architecture already supports external clients if we get there. |

---

## Open Questions

*None — all key decisions resolved during brainstorm.*

---

## Supersedes

This brainstorm supersedes the following earlier documents:
- `docs/brainstorms/2026-03-05-autonomous-social-platform-roadmap-brainstorm.md` — original 6-milestone roadmap
- `docs/brainstorms/2026-03-07-autonomous-ai-social-media-manager-brainstorm.md` — M1-M4 detailed plan with Thompson Sampling, module registry, client portal

Those documents remain for historical context but are no longer the active roadmap.
