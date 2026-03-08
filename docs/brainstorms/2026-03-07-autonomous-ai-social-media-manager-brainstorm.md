# Brainstorm: Autonomous AI Social Media Manager

**Date:** 2026-03-07
**Status:** Ready for planning

---

## What We're Building

A fully autonomous, self-improving social media management platform that acts as a full-service AI content strategist for a portfolio of client businesses. The AI researches industry trends, generates content briefs with specific reasoning for why content will perform, and either creates content automatically or notifies the client to provide assets — then schedules, publishes, and analyzes performance to continuously improve.

**The value proposition:** A client business puts in near-zero effort and gets a thriving, optimized social media presence. The AI tells them exactly what to create when human assets are needed, and does everything else itself.

---

## The Core Loop

```
Research (trends, competitors, Reddit, Google Trends, client history)
    ↓
ContentBrief Generation (what to post, why, expected impact, recommended format + format rationale)
    ↓
    ├── AI Fulfills Automatically (default path — all formats):
    │     ├── Text posts (Claude)
    │     ├── AI-generated images (Replicate/DALL-E + brand kit reference images)
    │     └── AI-generated video:
    │           ├── Talking head / avatar (HeyGen / Synthesia)
    │           ├── B-roll + voiceover (stock footage + ElevenLabs TTS)
    │           ├── Text-to-video (Runway / Kling / Sora)
    │           └── Image slideshow / carousel video (ffmpeg + brand images)
    │
    └── Client Upload Path (brand-specific real-world assets only):
          Client notified → uploads asset (their face, product, storefront)
          → AI writes copy, selects format, schedules post
              ↓ (if no upload within deadline)
          AI generates content automatically as fallback
    ↓
Published via Blotato API
    ↓
Metrics collected (72-hour observation window)
    ↓
Thompson Sampling posteriors updated — FORMAT is a primary optimization dimension
    (text vs. image vs. video type: did video outperform images this week?)
    ↓
Weekly: Claude analyzes performance patterns → ContentStrategy updated
    ↓
(loop repeats)
```

---

## Milestone Plan

### Milestone 1 — Foundation: Blotato + Workspaces
*Goal: Replace direct platform APIs with Blotato. Add workspace/business model. Manual posting works for 3+ client accounts across each platform.*

**What ships:**
- Replace all direct platform publish functions with Blotato API (`src/lib/blotato/`)
- Account connection via Blotato's hosted OAuth flow — eliminates Meta app review and TikTok approval requirements entirely
- `Business` workspace model: one partner login manages a portfolio of clients
- AI-driven onboarding wizard: client answers 5-10 questions (business type, industry, audience, tone, goals, competitors), Claude synthesizes into a `ContentStrategy` automatically
- Post composer updated to work within a selected workspace
- Content calendar view per workspace
- Manual scheduling end-to-end across all platforms
- Configurable review window per workspace (default off — partner enables for brand-sensitive clients)
- Auto-retry on publish failure (up to 3 attempts with backoff) + partner email alert on persistent failure

**Removed from codebase:**
- All `src/app/api/connect/*/` platform OAuth routes
- All platform-specific `publish*` and `refresh*Token` functions
- `src/lib/token.ts` (Blotato manages tokens)
- `src/lib/platforms/*/` (replaced by `src/lib/blotato/`)

**Exit criteria:** Partner can manage 3+ client workspaces, each with multiple platform accounts connected via Blotato, and schedule/publish posts manually to all platforms.

---

### Milestone 2 — Autonomous Content Intelligence
*Goal: AI researches, generates briefs, and either auto-creates content or notifies clients to provide assets. Zero required human input for routine posting.*

**Content Strategy per workspace:**
- Set automatically via onboarding wizard (M1)
- Fields: industry, target audience, content pillars, brand voice, posting cadence, optimization goal
- AI updates strategy based on performance (M3)

**Research Pipeline (4-hour cron per workspace):**
- Sources: Google Trends API, industry RSS feeds, Reddit (relevant subreddits), client's own historical post performance
- Pre-filter: keyword relevance scoring + recency decay — top 15 items passed to Claude
- Claude synthesizes themes (not summaries): identifies 2-3 genuine conversation opportunities, suggests contrarian/educational/community angles per theme, flags time-sensitive items
- Output stored as `ResearchSummary` record — cached, attached to briefs it informs

**ContentBrief Generation (weekly cron, Sunday night):**
- Generates N briefs per workspace using `ResearchSummary` + `ContentStrategy` + historical performance
- Platform-optimized posting volume (AI defaults: TikTok/Instagram Reels daily, Twitter/X 3-5x/week, Facebook/YouTube 2-3x/week — tuned per workspace over time)
- Each brief: topic, rationale (why now, expected performance), recommended format, platform targets, asset deadline, fulfillment path

**Brief Fulfillment — two paths:**
1. **AI Auto-Generates (default):** AI fulfills all content formats automatically. Checks brand kit first — uses brand photos/logos/color palette as reference inputs when available. Generates: text posts (Claude), images (Replicate/DALL-E with brand reference images), or video (provider selected based on workspace config and content type). Creates `SCHEDULED` post directly.
2. **Client Upload Path (brand-specific real-world assets only):** Used when the brief requires content that AI cannot authentically generate — the client's actual face, physical product, real storefront, live event. Email/SMS notification with tokenized upload link (no login required). Client uploads asset. AI receives it, writes copy, selects format, schedules post. If no upload within configurable deadline → AI generates fallback content automatically using brand kit.

**Brand Kit (per workspace):**
- Per-workspace S3 folder: logo, product photos, brand colors, style guidelines, example content
- AI uses brand assets as reference inputs for image/video generation (reference images, LoRA fine-tuning for brand-consistent output)
- AI indexes the library and selects relevant assets before each generation
- Client uploads brand assets via their notification link; partner can upload directly anytime
- Brand kit is the primary source of creative consistency — AI generation augments it, not the reverse

**Exit criteria:** A workspace with an active strategy auto-populates its content calendar weekly, routes each brief through the right fulfillment path, and publishes on schedule without human involvement beyond optional asset uploads.

---

### Milestone 3 — Self-Improving AI (Thompson Sampling + Claude Meta-Optimizer)
*Goal: Platform gets measurably smarter over time by learning from real performance data.*

**Optimization Algorithm: Discounted Thompson Sampling**

Research finding: Thompson Sampling is the correct algorithm for this use case. UCB over-commits before delayed feedback arrives. Epsilon-Greedy wastes scarce posts on random exploration. Thompson Sampling is naturally robust to delayed feedback, self-tunes exploration vs. exploitation, and requires no parameter tuning.

Key implementation details:
- **Observation window:** 72 hours after posting — metrics fetched then, posteriors updated
- **Decay factor:** 0.95/week applied to posteriors before each update — prevents the model from being locked into strategies that worked months ago
- **Reward function:** Composite weighted score: `likes×1 + comments×3 + shares×5 + saves×4` (normalized per platform)
- **Arm space:** Content configuration dimensions — FORMAT is a primary dimension alongside topic category, tone variant, CTA type, length bucket. Format arms: `text`, `image`, `video_talking_head`, `video_broll`, `video_text_to_video`, `video_slideshow`. Tested 2-3 dimensions at a time to avoid sparse data.
- **Cold start:** Industry-specific Beta priors (e.g., short-form video Beta(3,7) for consumer brands, educational long-form Beta(4,6) for B2B) + accelerated 30-day exploration phase (40% exploration posts, ensuring each format type gets sampled)
- **Upgrade path:** LinThompson Sampling (contextual bandit) available after 500+ posts per workspace — incorporates context like day of week, trending score, platform surface, brand kit richness

**Claude as Meta-Optimizer (weekly):**
- Given last 30 days of performance data + current arm posteriors, Claude reasons about patterns ("posts asking questions got 3× more comments"), identifies what to test next, and suggests new content arms to add
- Updates `ContentStrategy` with adjusted topic weights, content mix, posting cadence, optimal time windows
- Generates plain-language weekly digest: what the AI learned, what it changed, top/bottom performers

**Transfer Learning for Cold Start:**
- New workspace onboards: find closest existing client by industry/audience descriptors
- Weight their posteriors as informative priors for the new client
- Accelerated exploration phase (first 30 days, 40% of posts are deliberate experiments)

**Exit criteria:** After 4 weeks, demonstrable strategy shifts based on performance data — measurable improvement in engagement rates per workspace.

---

### Milestone 4 — Advanced Intelligence + Client Portal
*Goal: Expand content capabilities, add client visibility, increase AI sophistication.*

**Content capabilities:**
- Brand-consistent LoRA fine-tuning: train a custom image model on workspace brand assets for highly consistent AI visuals
- Cross-platform repurposing: one idea → Twitter thread + Instagram carousel + TikTok video + LinkedIn post, each format-optimized
- Campaign mode: themed content series (product launch, seasonal promotion, brand awareness push) with coordinated format mix
- Competitor monitoring: surface insights from what's working in client's competitive landscape
- A/B format experiments: same brief rendered as text vs. image vs. video to directly measure format impact

**Client portal:**
- Read-only view per workspace: upcoming content calendar, post performance dashboard, asset upload area
- No manager required for clients to check in, upload assets, or see results
- Reduces partner's time spent answering "how's our social doing?" questions

**A/B testing framework:**
- Explicit variant tests: AI generates two versions of a post, both scheduled, performance compared at observation window
- Winner's configuration weighted more heavily in future arm selection

---

## Key Architecture Decisions

### 1. Blotato as the Publishing Layer
Single `src/lib/blotato/` module replaces all platform-specific code. Blotato handles: platform OAuth, token management, publishing to Instagram/Facebook/TikTok/Twitter/YouTube. No Meta app review required.

### 2. Business/Workspace Model
```
User
 └── Business[]
      ├── ContentStrategy (1:1)
      ├── ResearchSummary[] (weekly, per research run)
      ├── ContentBrief[] (weekly batch)
      ├── SocialAccount[] (Blotato account references)
      ├── Post[] (all scheduled/published content)
      └── AssetLibrary (S3 prefix per business)
```

### 3. Thompson Sampling Engine (`src/lib/bandit.ts`)
Lightweight TypeScript — no ML libraries. Beta distribution sampling via math approximation. Posterior storage in `ContentArm` DB records. Decay applied before each update. Observation scheduling tracked in `PostObservation` table.

### 4. Research Pipeline (`src/cron/trends.ts`)
Runs every 4 hours per active workspace. Google Trends + RSS + Reddit → relevance filter (keyword overlap + recency decay) → top 15 items → Claude thematic synthesis → `ResearchSummary`. Weekly brief generation reads latest `ResearchSummary`.

### 5. Brand Kit + AI Generation Modules

**Brand Kit (per workspace):**
```
BrandKit {
  logo: S3 ref
  productPhotos: S3 ref[]
  colors: string[]          // hex palette
  styleGuidelines: string   // "clean minimalist", "bold lifestyle", etc.
  exampleContent: S3 ref[]  // example posts the AI should emulate
  loraModelId?: string      // fine-tuned model for brand-consistent image gen
}
```
Brand assets are passed as reference inputs to generation modules. AI generation without brand kit assets falls back to style description + color palette prompting.

**AI Generation Modules (platform-level, operator-defined):**

A module is a named, reusable pipeline of AI tool calls wired up by the platform operator. Each module declares:
- **capability** — what it produces (e.g., `talking_head_video`, `ai_image`, `text_to_video`, `slideshow_video`, `text_post`)
- **requiredInputs** — what must be provided (e.g., `script`, `avatarConfig`, `brandKit`)
- **optionalInputs** — what enhances output if available (e.g., `backgroundImage`, `music`)
- **outputType** — the artifact produced (e.g., `mp4`, `image_url`, `text`)
- **steps** — the sequence of AI tool calls executed internally

Example module definition:
```
Module: "heygen-talking-head-v1"
  capability: talking_head_video
  requiredInputs: [script, avatarConfig]
  optionalInputs: [brandColors, backgroundImage]
  outputType: mp4
  steps:
    1. Claude → refine script for spoken delivery
    2. ElevenLabs → generate voiceover from script
    3. HeyGen → render avatar video with voiceover
    4. ffmpeg → add branded intro/outro from brand kit
```

**Module selection:** The orchestration agent matches a content brief's required format to modules by capability. Each workspace configures a preferred module per capability — when multiple modules can fulfill the same capability, the workspace preference wins.

**Failure handling:** If a module's underlying service is unavailable (e.g., HeyGen outage), the platform sends an immediate alert to the partner and pauses generation for that capability. A human approves the next step — fall back to a different module, reschedule, or skip. No automatic fallback without approval.

**Near-term:** Modules are defined in code/config by the platform operator. **Future (M4+):** A UI for partners and admins to define and configure their own modules without code changes.

Tokenized public Next.js route (`/upload/[token]`). No auth required. Shows brief context + file upload. On upload: asset saved to S3 under workspace brand kit → triggers AI copy generation → post scheduled. Short token TTL matching brief deadline.

### 7. Notifications
AWS SES for email (already on AWS infrastructure). Brief notification: subject + brief summary + upload link. Weekly digest: performance summary in plain language. Future: SMS via SNS.

### 8. Failure Handling
Auto-retry up to 3× with exponential backoff (2min → 10min → 30min). On persistent failure: AWS SES alert to partner with post details and error. Post marked `FAILED`. Partner can retry manually via existing retry endpoint. Client not notified unless partner escalates.

### 9. Review Window
Configurable per workspace (default off). When enabled: posts created as `PENDING_REVIEW` status, not `SCHEDULED`. Partner reviews via dashboard. Posts not submitted within review window auto-publish. This is an opt-in safety valve, not a default workflow step.

---

## Data Model Changes

**New models needed:**
- `Business` — workspace entity
- `ContentStrategy` — AI-maintained strategy per business
- `ContentBrief` — weekly AI-generated content brief
- `ResearchSummary` — cached weekly research output
- `ContentArm` — Thompson Sampling arm with Beta posteriors (includes format as dimension)
- `PostObservation` — links post → arm, tracks 72h observation window
- `BrandKitItem` — S3 references per business (logo, product photos, example content, LoRA model ref)
- `GenerationModule` — platform-level module registry (capability, inputs, steps, status)
- `WorkspaceModuleConfig` — per-workspace preferred module per capability

**Modified models:**
- `Post` — add `businessId`, `armId`, `reviewWindowExpiresAt`, `blotato_post_id`
- `SocialAccount` — add `businessId`, replace encrypted tokens with Blotato account reference ID
- `User` — minimal change, scoping shifts to Business level

**PostStatus enum additions:**
- `PENDING_REVIEW` — in review window, not yet scheduled
- `RETRYING` — in retry backoff

---

## What Changes vs. Current Codebase

| Area | Current | After Pivot |
|---|---|---|
| Platform publishing | Direct API per platform | Blotato API |
| Account connection | Custom OAuth per platform | Blotato hosted flow |
| Token management | AES-256-GCM encrypted, manual refresh | Blotato manages |
| Data model | `User → SocialAccount, Post` | `User → Business → ContentStrategy, ContentBrief, Post` |
| AI generation | User-triggered, single post | Autonomous weekly batch, research-informed; all formats (text/image/video) |
| Content optimization | None | Discounted Thompson Sampling + Claude meta-optimizer; FORMAT is a primary arm dimension |
| Content briefs | None | AI-generated weekly, two fulfillment paths (AI auto or client real-asset upload) |
| Client handoff | None | Email/SMS + tokenized upload portal (real-world assets only) |
| Brand kit | None | Per-workspace: logo, product photos, colors, style guide, LoRA model, AI generation config |
| Trend research | None | 4-hour cron: Google Trends + RSS + Reddit → Claude synthesis |
| Self-improvement | None | Weekly metric analysis → strategy + arm posterior updates |
| Failure handling | Mark FAILED, manual retry | Auto-retry 3× + partner alert via SES |
| Review window | None | Configurable per workspace (default off) |
| Client portal | None | M4 |
| Platforms covered | Twitter ✅, YouTube ✅, Meta ⚠️, TikTok ⚠️ | All via Blotato ✅ |

---

## Resolved Questions

**Q: Does Blotato support Instagram and Facebook?** Confirmed yes.

**Q: Client onboarding?** AI-driven wizard — client answers 5-10 questions, Claude generates ContentStrategy automatically. Zero partner effort per new client.

**Q: Posting volume?** Platform-optimized, AI decides. Defaults: TikTok/Reels daily, Twitter 3-5x/week, Facebook/YouTube 2-3x/week. Tuned per workspace by the self-improvement loop over time.

**Q: Client portal?** Deferred to Milestone 4. Manager-only in M1-M3.

**Q: Failure handling?** Auto-retry 3× with backoff. Partner alert via SES on persistent failure. Client not notified.

**Q: Review window?** Configurable per workspace, default off. When on: posts hold as PENDING_REVIEW until approved or window expires.

**Q: Business types?** Mixed portfolio. ContentStrategy is fully configurable per workspace.

**Q: Autonomy level?** Fully autonomous. No required human approval. Review window is opt-in per workspace.

**Q: Content formats?** Text, images, and all AI-generated video types in M2 (talking head via HeyGen/Synthesia, b-roll + voiceover, text-to-video via Runway/Kling/Sora, image slideshow). AI generates all formats by default. Client upload path used only when content requires real-world assets (their actual face, product, storefront).

**Q: Image/video strategy?** Brand kit checked first — brand assets used as reference inputs for AI generation. AI generation without brand assets falls back to style description + color palette prompting. LoRA fine-tuning available in M4 for highest brand consistency.

**Q: Format optimization?** FORMAT is a primary Thompson Sampling dimension. The platform actively learns whether text, image, or which video type performs best per workspace — and shifts content mix accordingly.

**Q: AI provider flexibility?** Pluggable module architecture. Platform operator defines named generation modules in code — each module is a pipeline of AI tool calls with a declared capability, required inputs, and output type. Workspaces configure a preferred module per capability. Swapping underlying tools means defining a new module; existing workspace configs remain unchanged until updated.

**Q: Module outages?** No automatic fallback. If a module's dependency (e.g., HeyGen) is unavailable, an alert is sent to the partner and generation is paused for that capability pending human approval of next steps.

**Q: Module UI?** Near-term: operator-defined in code. M4+: UI for partners/admins to define and configure their own modules.

**Q: Primary optimization goal?** Engagement (composite: likes×1, comments×3, shares×5, saves×4). Configurable per workspace in M3.

**Q: Optimization algorithm?** Discounted Thompson Sampling. Industry priors for cold start. LinThompson (contextual) after 500+ posts. Claude as weekly meta-optimizer reasoning over performance patterns.

**Q: Research sources?** Google Trends + industry RSS + Reddit + client's own performance history. 4-hour poll cadence. Top 15 items → Claude thematic synthesis (not per-article summaries).
