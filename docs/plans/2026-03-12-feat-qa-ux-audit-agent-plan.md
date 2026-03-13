---
title: "feat: QA/UX Audit Agent (Phase 1)"
type: feat
status: active
date: 2026-03-12
deepened: 2026-03-12
---

# QA/UX Audit Agent - Phase 1

## Enhancement Summary

**Deepened on:** 2026-03-12
**Research agents used:** Playwright best practices, Claude vision API, Playwright API docs, TypeScript reviewer, architecture strategist, performance oracle, security sentinel, simplicity reviewer, agent-native reviewer, pattern recognition specialist

### Key Improvements
1. **Atomic issues per finding** — each finding becomes its own GitHub issue with fingerprint, structured metadata, and suggested files, enabling direct handoff to the issue-worker pipeline
2. **Complexity-based routing** — findings are classified as simple (direct fix) or complex (requires plan), both requiring human approval via label change before progressing
3. **Simplified architecture** — reduced from 7 files to 3 files (entry point + config + lib), following existing `scripts/` conventions
4. **Robust screenshot capture** — custom load detection (not `networkidle`), animation disabling, lazy-image scrolling, fresh browser contexts per viewport
5. **Secure `gh` CLI usage** — `execFileSync` with argument arrays to prevent command injection from AI-generated content
6. **Pipelined performance** — navigate to page N+1 while analyzing page N; resize screenshots with `sharp` before sending to Claude; ~6-8 min total runtime

### New Considerations Discovered
- `src/lib/storage.ts` imports `env.ts` which validates ALL env vars at import time — script must use standalone S3 helper
- Claude vision auto-downscales images over 1568px on the long edge — resize before sending to save tokens/latency
- `networkidle` is officially discouraged by Playwright — use custom skeleton/spinner detection instead
- Individual issues with fingerprints enable deduplication in future runs without schema changes

---

## Overview

A CLI script (`npm run qa:audit`) that launches a headless browser, crawls every dashboard page at mobile and desktop widths, sends screenshots to Claude's vision API for UX analysis, and creates **individual atomic GitHub issues** for each finding — ready for human triage and handoff to the existing issue-worker pipeline.

## Problem Statement / Motivation

There is no automated way to catch visual regressions, layout bugs, or UX issues across the app. Manual QA is slow and inconsistent. An AI-powered audit agent can systematically evaluate every page and surface objective issues that humans might miss, filing them as actionable issues that flow directly into the existing fix pipeline.

## Proposed Solution

A TypeScript CLI script at `scripts/qa-audit.ts` that:

1. Validates preconditions (dev server running, real API keys, `gh` authenticated)
2. Launches headless Playwright, authenticates via the existing test session endpoint
3. Crawls a configured route manifest at 375px (mobile) and 1440px (desktop)
4. Takes full-page screenshots, resizes with `sharp`, uploads to S3
5. Sends mobile+desktop screenshot pairs to Claude vision API with a structured evaluation prompt
6. For each finding: creates an individual GitHub issue with fingerprint, screenshot, severity, complexity classification, and suggested files
7. Creates a lightweight index issue linking all finding issues for the run

### Architecture

```
scripts/qa-audit.ts              # Entry point, orchestrator, CLI arg parsing
scripts/lib/qa-audit/
  config.ts                      # Route manifest, viewport config, prompt template, types
  audit.ts                       # Core logic: crawl, analyze, report (exportable as library)
```

### Research Insights

**Why 3 files instead of 7:** The simplicity reviewer identified that 7 files is enterprise architecture for what is fundamentally a ~400-line script. The pattern recognition specialist confirmed that existing scripts (`backfill-fingerprints.ts`) use a flat layout with helpers under `scripts/lib/`. The core logic lives in `audit.ts` as an exportable function so future agents can call `runQaAudit(options)` programmatically without the CLI wrapper.

**Why not import from `src/lib/storage.ts`:** The architecture strategist identified that `storage.ts` imports `env.ts`, which eagerly validates ALL server env vars (`GOOGLE_CLIENT_ID`, `NEXTAUTH_SECRET`, etc.) at import time. The script would crash before running. Instead, `audit.ts` includes a standalone ~15-line S3 upload helper that reads only `AWS_S3_BUCKET`, `AWS_S3_PUBLIC_URL`, and `AWS_REGION`.

## Technical Considerations

### Authentication

The dev server must be running with `PLAYWRIGHT_E2E=true` and `ALLOWED_EMAILS` including `test@example.com`. The script hits `GET /api/test/session?email=test@example.com` to obtain a session cookie, matching the existing E2E test pattern from `e2e/fixtures/auth.setup.ts`.

### Dynamic Route Resolution

Routes with parameters (`[id]`, `[groupId]`) are resolved by querying the database via relative import (`../src/lib/db`). The route manifest maps each parameterized route to a Prisma query that fetches a concrete ID.

### Page Load Detection

**Do NOT use `networkidle`** — it is officially discouraged by Playwright and unreliable with Next.js App Router streaming/Suspense.

Instead, use a custom readiness check:

```typescript
async function waitForPageReady(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  // Wait for loading skeletons/spinners to disappear
  await page.waitForFunction(
    () => document.querySelectorAll('.skeleton, [aria-busy="true"], .loading-spinner').length === 0,
    { timeout: 15000 }
  );
  // Wait for fonts to load
  await page.waitForFunction(() => document.fonts.ready.then(() => true));
  // Brief stability pause
  await page.waitForTimeout(500);
}
```

If a page fails to load (timeout, HTTP error), capture the error state screenshot anyway and file it as a "page load failure" finding.

### Screenshot Strategy

- **Full-page screenshots** (`fullPage: true`) with `animations: "disabled"` and `caret: "hide"`
- **Fresh browser context per viewport** — media queries fire cleanly from initial load, no resize transition artifacts
- **Scroll to trigger lazy images** before capturing:
  ```typescript
  await page.evaluate(async () => {
    let y = 0;
    while (y < document.body.scrollHeight) {
      window.scrollBy(0, 300);
      y += 300;
      await new Promise(r => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  ```
- **Resize with `sharp`** before upload/analysis — cap width at 1024px, convert to JPEG quality 85. Reduces Claude vision tokens by ~30% and S3 upload time by ~50% with no meaningful quality loss for UX audit
- **Mobile** context: 375x812, `deviceScaleFactor: 2`, `colorScheme: "dark"`
- **Desktop** context: 1440x900, `deviceScaleFactor: 1`, `colorScheme: "dark"`
- **S3 key pattern**: `screenshots/qa-audit/<date>/<nonce>/<route-slug>-<width>.jpg` (nonce prevents URL enumeration)
- **Import from `playwright`** (the library), not `@playwright/test` (the test runner)

### Claude Vision Analysis

**Send mobile + desktop together** (2 images per request per page) so Claude can catch responsive-specific issues. Use forced tool choice for structured JSON output with confidence scoring.

```typescript
const uiAnalysisTool: Anthropic.Tool = {
  name: "report_ui_findings",
  description: "Report UI/UX findings from screenshot analysis",
  input_schema: {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["critical", "warning", "info"] },
            type: { type: "string", enum: ["layout", "visual-bug", "accessibility", "responsiveness", "ux"] },
            description: { type: "string" },
            location: { type: "string" },
            viewport: { type: "string", enum: ["mobile", "desktop", "both"] },
            confidence: { type: "number", description: "0.0 to 1.0" },
            complexity: { type: "string", enum: ["simple", "complex"], description: "simple = CSS/markup fix, complex = logic/architecture change" },
            reasoning: { type: "string", description: "Brief analysis notes" },
          },
          required: ["severity", "type", "description", "location", "viewport", "confidence", "complexity"],
        },
      },
      page_summary: { type: "string" },
    },
    required: ["findings", "page_summary"],
  },
};
```

**Cache the system prompt** with `cache_control: { type: "ephemeral" }` — saves ~90% on the repeated system prompt tokens across 16 API calls.

**Filter findings below 0.7 confidence** before creating issues. Present 0.5-0.7 findings only in the index issue as "uncertain" items for human review.

### GitHub Issue Creation — Atomic Issues per Finding

Each finding becomes its own GitHub issue, following the bug-monitor's structured format. Use `execFileSync("gh", [...])` with argument arrays — **never** string interpolation — to prevent command injection from AI-generated content.

**Individual finding issue format:**

```markdown
**Fingerprint:** `<sha256(route + viewport + type + normalized_description)>`

## Finding
**Page:** /dashboard/posts (desktop, 1440px)
**Type:** layout | **Severity:** warning | **Confidence:** 0.92

The post card grid overflows horizontally on posts with long titles,
causing a horizontal scrollbar.

## Screenshot
![screenshot](https://s3-url/screenshots/qa-audit/2026-03-12/<nonce>/posts-list-1440.jpg)

## Suggested Files
- `src/app/dashboard/posts/page.tsx`
- `src/components/posts/PostCard.tsx`

## Complexity
**Simple fix** — CSS/markup change, no logic changes required.

<!-- qa-finding: {"fingerprint":"a1b2c3...","route":"/dashboard/posts","viewport":1440,"type":"layout","severity":"warning","confidence":0.92,"complexity":"simple"} -->

---
_Filed automatically by QA/UX audit agent — run 2026-03-12_
```

**Labeling and routing:**

| Complexity | Labels | What happens after human approval |
|---|---|---|
| Simple fix | `qa-audit`, `needs-triage`, `simple-fix` | Human changes `needs-triage` → `claude-ready`. Issue-daemon picks it up, issue-worker implements the fix directly. |
| Complex fix | `qa-audit`, `needs-triage`, `needs-plan` | Human changes `needs-triage` → `claude-ready`. Issue-daemon picks it up, plan-executor creates a plan first, then the plan goes through plan-review → approval → implementation. |

This matches the existing issue-daemon pipeline exactly — no daemon code changes needed. The `simple-fix` and `needs-plan` labels are informational hints that the issue-worker can read from the issue body's `complexity` field to decide its approach.

**Index issue** (one per run):

```markdown
# QA/UX Audit — 2026-03-12

**Pages crawled:** 16 | **Viewports:** mobile (375px), desktop (1440px)
**Findings:** 8 total (2 critical, 3 warning, 3 info)
**Uncertain (< 0.7 confidence):** 2 items listed below

## Finding Issues
- #201 — [critical] Post card overflow on mobile (/dashboard/posts)
- #202 — [warning] Calendar horizontal scroll (/dashboard/calendar)
- ...

## Uncertain Findings (needs human review)
- /dashboard/analytics — "Chart legend may be truncated" (confidence: 0.55)
- ...

---
_QA/UX audit run 2026-03-12 — 16 pages, 32 screenshots_
```

Labels: `qa-audit`, `qa-audit-index` (index issue only, not `needs-triage`)

**Deduplication:** Before creating each finding issue, check for existing open issues with the same fingerprint prefix:
```typescript
execFileSync("gh", ["issue", "list", "--label", "qa-audit", "--search", fingerprintPrefix, "--json", "number,state", "--jq", ".[0].number"]);
```
If found and open, skip (or add a comment "Still present as of <date>"). If found and closed, create new issue noting "Regression: previously fixed in #<old>."

### Cost & Performance

- ~16 Claude vision API calls (mobile+desktop paired per page): ~$1-2 per run
- **Pipelined execution:** navigate to page N+1 while analyzing page N
- `Promise.all` for S3 upload + Claude analysis (upload runs free during API wait)
- Process-and-discard screenshot buffers (no memory accumulation)
- Expected runtime: **6-8 minutes** for 16 routes × 2 viewports

### Security Considerations

| Concern | Mitigation |
|---|---|
| Command injection via `gh` CLI | `execFileSync` with argument arrays, never string interpolation |
| Screenshot data leakage (public S3) | Random nonce in S3 key path; synthetic seed data only; S3 lifecycle rule to expire after 30 days |
| S3 key path injection | Sanitize slugs: `slug.replace(/[^a-zA-Z0-9_-]/g, "_")` |
| Test session endpoint in production | Already gated by `PLAYWRIGHT_E2E` env var; add `NODE_ENV !== "production"` guard as defense-in-depth |
| API key exposure in logs | Never log any portion of `ANTHROPIC_API_KEY`; only log presence/format validation |
| SSRF via Playwright navigation | Validate all URLs against `localhost` before navigation |

## Seed Data Expansion

The current `prisma/seed.ts` needs expansion as a **separate prerequisite task** (not baked into the audit script). The audit script's precondition check verifies required data exists and fails with "Run `npx prisma db seed` first" if missing.

| Route | Missing Seed Data |
|---|---|
| `/dashboard/briefs` | Brief records (at least 1 fulfilled, 1 pending) |
| `/dashboard/review` | Post in `PENDING_REVIEW` status |
| `/dashboard/analytics` | PostMetrics for published posts |
| `/dashboard/insights` | ContentStrategy + strategy digest data |
| `/dashboard/strategy` | ContentStrategy record |

## Route Manifest

```typescript
interface RouteConfig {
  path: string;
  name: string;
  suggestedFiles: string[];  // Source files for issue-worker to investigate
  resolvePath?: () => Promise<string>;  // For dynamic routes
}

const ROUTES: RouteConfig[] = [
  // Static routes
  { path: "/dashboard", name: "dashboard-overview",
    suggestedFiles: ["src/app/dashboard/page.tsx"] },
  { path: "/dashboard/posts", name: "posts-list",
    suggestedFiles: ["src/app/dashboard/posts/page.tsx", "src/components/posts/PostCard.tsx"] },
  { path: "/dashboard/posts/new", name: "posts-new",
    suggestedFiles: ["src/app/dashboard/posts/new/page.tsx"] },
  { path: "/dashboard/calendar", name: "calendar",
    suggestedFiles: ["src/app/dashboard/calendar/page.tsx"] },
  { path: "/dashboard/analytics", name: "analytics",
    suggestedFiles: ["src/app/dashboard/analytics/page.tsx"] },
  { path: "/dashboard/accounts", name: "accounts",
    suggestedFiles: ["src/app/dashboard/accounts/page.tsx"] },
  { path: "/dashboard/briefs", name: "briefs",
    suggestedFiles: ["src/app/dashboard/briefs/page.tsx"] },
  { path: "/dashboard/review", name: "review-queue",
    suggestedFiles: ["src/app/dashboard/review/page.tsx"] },
  { path: "/dashboard/insights", name: "insights",
    suggestedFiles: ["src/app/dashboard/insights/page.tsx"] },
  { path: "/dashboard/strategy", name: "strategy",
    suggestedFiles: ["src/app/dashboard/strategy/page.tsx"] },
  { path: "/dashboard/businesses", name: "businesses",
    suggestedFiles: ["src/app/dashboard/businesses/page.tsx"] },

  // Dynamic routes (resolved after seeding)
  { path: "/dashboard/posts/:postId", name: "post-detail",
    suggestedFiles: ["src/app/dashboard/posts/[id]/page.tsx"],
    resolvePath: async () => { /* query first post ID */ } },
  { path: "/dashboard/posts/:postId/edit", name: "post-edit",
    suggestedFiles: ["src/app/dashboard/posts/[id]/edit/page.tsx"],
    resolvePath: async () => { /* query draft post ID */ } },
  { path: "/dashboard/businesses/:businessId", name: "business-detail",
    suggestedFiles: ["src/app/dashboard/businesses/[id]/page.tsx"],
    resolvePath: async () => { /* query first business ID */ } },
  { path: "/dashboard/businesses/:businessId/onboard", name: "business-onboard",
    suggestedFiles: ["src/app/dashboard/businesses/[id]/onboard/page.tsx"],
    resolvePath: async () => { /* query first business ID */ } },
];
```

**Note:** `/dashboard/dev-tools` excluded from audit — it renders debugging information that could contain sensitive data.

## Claude Vision Prompt Template

```
You are a senior QA engineer specializing in visual UI testing. You analyze screenshots for functional defects, NOT aesthetic preferences.

Context:
- This is a dark-mode social media management dashboard
- Design system: dark zinc backgrounds (zinc-950/900/800), violet-600 accents, white/zinc text
- Built with Tailwind CSS, mobile-first responsive design
- The sidebar collapses on mobile (< 768px) and expands on desktop
- Two screenshots are provided: mobile (375px) and desktop (1440px) of the same page

RULES:
- Only report issues that would be filed as bugs, not style opinions
- Every finding must reference a specific element and its location
- If you are uncertain, include your confidence level (0.0-1.0)
- Do NOT report: font choice preferences, color palette opinions, layout alternatives, subjective spacing
- Do NOT flag intentional empty states when there is no data to display
- DO report: overlapping elements, truncated text, broken alignment, missing content, contrast failures, responsive breakage, z-index issues

ANALYSIS STEPS:
1. Identify the page type and primary content areas
2. Check text readability (truncation, overflow, contrast)
3. Check layout integrity (alignment, spacing consistency, overlaps)
4. Check interactive elements (buttons visible, links distinguishable)
5. Compare mobile vs desktop — flag responsive breakage where elements work at one width but break at the other

COMPLEXITY CLASSIFICATION:
- "simple" = CSS/markup fix (padding, overflow, z-index, display property, font-size)
- "complex" = requires logic changes, data model updates, component restructuring, or architecture decisions

For each finding, provide severity, type, description, location, viewport, confidence (0.0-1.0), and complexity.
If the page looks correct with no issues, return an empty findings array.
```

## Acceptance Criteria

### Functional Requirements

- [ ] `npm run qa:audit` runs the audit script end-to-end
- [ ] `npm run qa:audit -- --dry-run` skips S3 upload and GitHub issue creation, prints findings to console as JSON
- [ ] `npm run qa:audit -- --output json` writes full audit report as JSON to stdout
- [ ] Script validates preconditions before launching browser (server reachable, real Anthropic key, `gh` authenticated)
- [ ] All 15 routes are crawled at both mobile (375px) and desktop (1440px) viewports
- [ ] Screenshots are resized with `sharp` (1024px max width, JPEG quality 85) before upload and analysis
- [ ] Mobile + desktop screenshots sent together per page for responsive comparison
- [ ] Each finding with confidence >= 0.7 creates an individual GitHub issue with fingerprint, screenshot, severity, complexity, and suggested files
- [ ] Findings with confidence < 0.7 are listed in the index issue only
- [ ] Simple findings labeled `qa-audit`, `needs-triage`, `simple-fix`
- [ ] Complex findings labeled `qa-audit`, `needs-triage`, `needs-plan`
- [ ] Index issue created linking all finding issues for the run
- [ ] Deduplication: existing open issues with same fingerprint are skipped (comment added instead)
- [ ] Partial failures (e.g., one page fails to load) do not abort the entire audit
- [ ] Console shows progress (page name, viewport, finding count) as the audit runs

### Non-Functional Requirements

- [ ] Script completes in under 10 minutes for the full route manifest
- [ ] Exit code 0 = audit completed (regardless of findings), exit code 1 = script error
- [ ] No `src/lib/storage.ts` or `src/env.ts` imports — standalone S3 helper only

### Quality Gates

- [ ] Unit tests for analyzer (mock Claude response, verify finding extraction and Zod validation)
- [ ] Unit tests for reporter (mock `gh` CLI, verify issue body format and label assignment)
- [ ] Integration test: dry-run mode produces valid JSON output

## Implementation Plan

### Step 1: Expand seed data (`prisma/seed.ts`)

Add ContentStrategy, Brief (fulfilled + pending), PENDING_REVIEW post, PostMetrics. This is independently valuable and a prerequisite for the audit.

Files: `prisma/seed.ts`

### Step 2: Create config and types (`scripts/lib/qa-audit/config.ts`)

Define all types (`Finding`, `PageResult`, `AuditReport`, `RouteConfig`, `ViewportConfig`), the route manifest with `suggestedFiles`, viewport configs, and the prompt template. Use discriminated unions for `PageResult` (success vs error states).

```typescript
type PageResult =
  | { status: "success"; route: RouteConfig; viewport: ViewportConfig; screenshotBuffer: Buffer; findings: Finding[] }
  | { status: "error"; route: RouteConfig; viewport: ViewportConfig; error: string };
```

Files: `scripts/lib/qa-audit/config.ts`

### Step 3: Build core audit logic (`scripts/lib/qa-audit/audit.ts`)

The main module, exported as `runQaAudit(options)` for both CLI and future programmatic use. Contains:

- **Precondition checks** — server reachable, `ANTHROPIC_API_KEY` present and not mock, `gh auth status` (skippable in dry-run). Let libraries throw natural errors for most failures; only pre-check things that would be confusing.
- **Crawler** — launch Playwright (`playwright` library, not `@playwright/test`), fresh context per viewport with `colorScheme: "dark"`, authenticate via test session endpoint, custom load detection (no `networkidle`), scroll for lazy images, `sharp` resize.
- **Analyzer** — send mobile+desktop pair to Claude vision API with forced tool choice, Zod-validate response, generate fingerprints per finding.
- **Reporter** — standalone S3 upload helper (~15 lines, reads only `AWS_S3_BUCKET`/`AWS_S3_PUBLIC_URL`/`AWS_REGION`), individual issue creation via `execFileSync("gh", [...])`, index issue creation, deduplication check, console progress output.
- **Pipelining** — navigate to page N+1 while analyzing page N; `Promise.all` for S3 upload + Claude analysis.

Files: `scripts/lib/qa-audit/audit.ts`

### Step 4: Wire up CLI entry point (`scripts/qa-audit.ts`)

Parse CLI args with `node:util` `parseArgs` (built-in, no new dependency):
- `--dry-run` — skip S3, skip GitHub, skip Claude API, output screenshots to `tmp/qa-audit/`
- `--output json` — write full report as JSON to stdout
- `--base-url <url>` — default `http://localhost:3000`
- `--verbose` — detailed logging

Add `"qa:audit": "npx tsx scripts/qa-audit.ts"` to `package.json`.

Files: `scripts/qa-audit.ts`, `package.json`

### Step 5: Tests

Unit tests for Zod schema validation (mock Claude responses), issue body markdown generation, fingerprint generation, and label assignment logic.

Files: `scripts/__tests__/qa-audit.test.ts`

### Step 6: Add `sharp` dev dependency

```bash
npm install -D sharp @types/sharp
```

Files: `package.json`, `package-lock.json`

## Issue Lifecycle Flow

```
┌─────────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│  QA Audit    │────>│  GitHub Issue │────>│ Human Triage  │────>│ Issue Worker  │
│  Agent runs  │     │  created with │     │ reviews issue,│     │ picks up      │
│  finds bug   │     │  needs-triage │     │ approves via  │     │ claude-ready  │
│              │     │  + simple-fix │     │ label change  │     │ issue, fixes  │
│              │     │  or needs-plan│     │ to claude-    │     │ it (or plans  │
│              │     │              │     │ ready         │     │ first)        │
└─────────────┘     └──────────────┘     └───────────────┘     └──────────────┘

Simple fix path:   qa-audit → needs-triage → [human approves] → claude-ready → issue-worker fixes directly
Complex fix path:  qa-audit → needs-triage → [human approves] → claude-ready → plan-executor → plan-review → [human approves plan] → issue-worker implements
```

## Dependencies & Risks

| Dependency | Risk | Mitigation |
|---|---|---|
| Playwright installed | Low — already a dev dependency | Precondition check |
| Real `ANTHROPIC_API_KEY` | Medium — dev default is mock key | Precondition check; `--dry-run` skips API calls entirely |
| S3 credentials locally | Medium — not all devs have them | `--dry-run` saves to `tmp/qa-audit/` locally |
| `gh` CLI authenticated | Low — standard dev tool | Precondition check |
| Dev server with `PLAYWRIGHT_E2E=true` | Medium — easy to forget | Precondition check with clear error message |
| Claude vision API rate limits | Low — only 16 calls per run | Sequential with pipelining; retry with backoff for 429/503 |
| `sharp` native dependency | Low — widely used | Install as dev dependency; falls back to raw buffer if unavailable |

## Future Considerations (Phase 2+)

- **Cron automation**: Weekly GitHub Action or Lambda trigger
- **Flow testing**: Script user journeys (create post, schedule, verify publish)
- **Baseline comparison**: Diff screenshots against a known-good baseline
- **CI integration**: Run on PR branches, block merge on critical findings
- **Auto-approval**: High-confidence + critical severity findings skip triage, go straight to `claude-ready`

## Sources & References

- Existing E2E auth pattern: `e2e/fixtures/auth.setup.ts`
- S3 upload utility (reference only, not imported): `src/lib/storage.ts:uploadBuffer`
- Claude AI patterns: `src/lib/ai/index.ts`
- Bug monitor issue creation: `scripts/bug-monitor.sh`
- Issue daemon pipeline: `scripts/issue-daemon.sh`
- Visual testing rules: `.claude/rules/visual-testing.md`
- Design system tokens: `.claude/rules/design-system.md`
- Playwright docs: `waitForLoadState`, `screenshot`, `setViewportSize`, `addCookies`
- Claude vision docs: image encoding, token calculation (`width*height/750`), structured outputs with tool_choice
- Anthropic prompt caching: `cache_control: { type: "ephemeral" }`
