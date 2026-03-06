# Brainstorm: Autonomous AI Social Media Platform — Milestone Roadmap

**Date:** 2026-03-05
**Status:** Draft

---

## What We're Building

Transforming the current POC social media management tool into a fully self-managed AI social media platform that can grow a brand's presence across all major platforms. The platform supports two distinct workflow modes per business, and the AI gets smarter over time by learning from performance data.

**Two workflow modes (configurable per business):**
- **AI-generated**: Platform creates and publishes content autonomously (text, images, eventually video)
- **AI-informed**: Platform acts as a content strategist — recommends what to make, human creates it, then uploads to be scheduled and posted

**POC starting point:** AI-informed mode for Josh + business partner's accounts across all 5 platforms.

---

## Why This Approach (Parallel Tracks)

Start with platform breadth (all 5 platforms) immediately, then layer intelligence on top. This gets the less technical business partner up and running quickly while validating the AI strategy loop early. The platform provides increasing value at each milestone rather than holding back all intelligence features until platforms are "done."

---

## Current State (What's Already Built)

- **Connected platforms:** X/Twitter, Instagram, Facebook (OAuth, publish, metrics)
- **Not yet integrated:** TikTok, YouTube
- **Working:** Post composer, AI text generation, scheduled publishing (cron), media uploads (S3), analytics metrics fetching
- **Access control:** Email allowlist (ALLOWED_EMAILS env var)

---

## Milestone Roadmap

### Milestone 1 — Full Platform Connect (Working Product)
*Goal: Business partner can connect all accounts and post manually*

- Add TikTok OAuth connect + basic posting (video upload support)
- Add YouTube OAuth connect + basic posting (video upload + description/tags)
- Verify X, Instagram, Facebook posting works reliably end-to-end
- Content calendar / queue view (replace basic post list)
- Media upload UX improvements (drag-and-drop, multi-file, video preview)
- Post status and history per platform

**Exit criteria:** Both partners can log in, connect all 5 accounts, manually compose and schedule posts with media.

---

### Milestone 2 — Brand Profile + AI Content Advisor
*Goal: Platform acts as a content strategist, not just a scheduler*

- Brand profile setup per business: niche, tone, target audience, content pillars, posting goals
- AI content brief generator: weekly/daily recommendations for what content to create ("Create a 60-sec TikTok showing X, post Wednesday at 7pm")
- Content idea queue: AI-generated list of upcoming content suggestions the human can accept, reject, or edit
- Basic content calendar with suggested posting cadence per platform

**Exit criteria:** Platform surfaces actionable content ideas; human acts on them and uploads the result.

---

### Milestone 3 — AI-Generated Content (Text + Images)
*Goal: Platform can create and publish content without human-created assets*

- AI text generation refined per platform voice/format (already partially exists, enhance with brand profile context)
- Image generation integration (via Replicate or similar — product shots, graphics, quote cards)
- Per-business workflow mode setting: AI-generated vs AI-informed
- Approval queue: posts AI intends to publish, with approve/reject/edit before sending
- Platform-specific content optimization (character limits, hashtag strategy, best times)

**Exit criteria:** A business in AI-generated mode has posts drafted, queued, and published without human-created assets.

---

### Milestone 4 — Performance Intelligence + Strategy Loop
*Goal: AI learns what works and refines its own strategy*

- Cross-platform analytics dashboard (aggregate reach, engagement, growth across all 5 platforms)
- Performance-to-strategy feedback: AI reads post metrics and updates content strategy recommendations
- Content performance scoring (what topics/formats/times perform best per platform)
- Strategy summary report (weekly digest: what worked, what to do more of, what to drop)
- A/B content variants: AI tests different angles on the same content idea

**Exit criteria:** AI's content recommendations measurably improve based on past performance data.

---

### Milestone 5 — Multi-Business Architecture
*Goal: Platform supports multiple brands, each with their own profile and autonomy settings*

- Business/workspace model: each brand is isolated with its own accounts, profile, content, and settings
- Per-business autonomy level: AI-informed, AI-generated with approval, or fully autonomous
- Invite/access model: business owner + team members per workspace
- Billing hooks (placeholder for future monetization, even if not active)
- Admin view: platform owner can see all businesses and their activity

**Exit criteria:** Second business can be onboarded without code changes; each brand's data and settings are fully isolated.

---

### Milestone 6 — Autonomous AI Agents + Self-Improvement
*Goal: Platform runs itself, continuously improving outcomes per business*

- AI agent loop: generates content → publishes → reads metrics → updates strategy → repeat
- Agent memory: learns brand voice, what resonates with the audience, and competitor context over time
- Self-improving content strategy: agent proposes strategy changes (cadence, platform mix, content types) for human approval before executing
- AI-generated video: integrate Runway/Sora/similar for short-form video creation
- Anomaly alerts: notify humans only when performance drops, errors occur, or strategy confidence is low
- Multi-agent architecture: separate agents for strategy, content creation, scheduling, and analytics

**Exit criteria:** A business in fully autonomous mode runs for 30 days with no human intervention, and performance metrics improve week-over-week.

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Workflow modes | Two distinct modes per business (AI-generated / AI-informed) | Different businesses have different appetite for automation |
| Autonomy level | Configurable per business | One-size-fits-all autonomy doesn't work across business types |
| Brand context input | Start simple (form), evolve from performance | YAGNI — structured onboarding can be refined once we know what data actually matters |
| Video strategy | Manual upload first, AI-generated in Milestone 6 | Video generation APIs are expensive and complex — earn that with earlier milestones |
| Business model | TBD | POC first; lock in model once platform proves value |
| Milestone structure | Parallel tracks (breadth then intelligence) | Gets business partner productive immediately while validating AI value loop early |

---

## Open Questions

1. **YouTube quota:** YouTube Data API has daily upload quotas. Is there a target posting frequency we should validate against before Milestone 1 ships?
2. **AI-generated image style (M3):** Should AI-generated images be brand-consistent (requires brand style guide input) or is prompt-based/generic fine for the initial POC?

---

## Resolved Questions

- **Business types:** Multiple — platform must be brand-agnostic from the start
- **Autonomy:** Configurable per business (not a global platform setting)
- **Brand context:** Start with simple topic/tone setup; AI refines from performance data
- **Video in POC:** Manual uploads; AI-generated video is a later milestone (Milestone 6)
- **First workflow mode:** AI-informed (human creates, AI advises and schedules)
- **Milestone structure:** Option B — parallel tracks
- **TikTok API:** Need to apply for business API access. Plan: apply now, build TikTok UI in parallel, ship TikTok integration when approved — does not block rest of Milestone 1
- **Approval UX:** In-app queue (web dashboard) for Milestone 3; mobile approvals are a later enhancement
- **Content calendar model:** AI owns the calendar — fills it with content briefs/ideas; human accepts, rejects, or swaps, then uploads their created content
