---
title: "Optimize CLAUDE.md for Compound-Engineering Workflow"
type: feat
status: completed
date: 2026-03-08
deepened: 2026-03-08
---

# Optimize CLAUDE.md for Compound-Engineering Workflow

## Enhancement Summary

**Deepened on:** 2026-03-08
**Research agents used:** architecture-strategist, code-simplicity-reviewer, pattern-recognition-specialist, create-agent-skills researcher, Claude Code docs researcher

### Key Improvements from Deepening
1. **Simplified from 5 phases to 3 steps** — simplicity reviewer flagged over-engineering for what is essentially editing text files
2. **Fixed stale platform paths** — `src/lib/platforms/` is empty after Blotato migration; rules must target `src/lib/blotato/**`
3. **Clarified MEMORY.md is user-local** — not committed to git; cleanup is a manual action, not a version-controlled change
4. **Confirmed frontmatter format** — path-scoped rules use `paths:` (not `globs:`) per official docs
5. **Added Prisma mock snippet to always-loaded tier** — too critical to relegate to path-scoped rules only
6. **Removed dual source-of-truth risk** — CLAUDE.md summaries reference rules files without duplicating specific values
7. **Added compound-engineering.local.md spec** — setup skill auto-detects TypeScript stack and configures review agents

### Corrections from Review Agents
- **Architecture strategist:** platforms.md targets stale paths; Prisma mock pattern must stay in CLAUDE.md; env var list should move out; add E2E content somewhere
- **Simplicity reviewer:** 3 rules files may be over-engineered; compound-engineering.local.md and docs/solutions/ are YAGNI; 5-phase plan is too much for editing text files
- **Pattern recognition:** deployment.md conflates 3 domains; no naming convention for docs/solutions/; stale Railway refs in settings.local.json

---

## Overview

Restructure CLAUDE.md, MEMORY.md, and supporting config files to maximize Claude Code effectiveness while staying under Anthropic's recommended 200-line budget. Integrate compound-engineering plugin workflows as the primary task orchestration system, replacing the generic workflow patterns in `.claude/CLAUDE_TEST.md`.

## Problem Statement

Current state has three problems:

1. **Duplication** — CLAUDE.md (94 lines) and MEMORY.md (132 lines) overlap ~40%, wasting ~100 tokens every session on redundant content
2. **Critical rules in wrong place** — TDD, never-auto-commit, design system, and CI rules live only in MEMORY.md (user-level auto-memory, not in git). If the auto-memory is lost or corrupted, these rules vanish.
3. **No workflow orchestration** — CLAUDE.md has zero guidance on how to approach tasks. The draft `.claude/CLAUDE_TEST.md` has good ideas but conflicts with compound-engineering conventions (e.g., `tasks/todo.md` vs `docs/plans/`, generic "subagents" vs `/ce:` commands)

### Research Insight: CLAUDE.md vs MEMORY.md Loading

Per official Anthropic docs (confirmed 2026):
- **CLAUDE.md** loads in **full** regardless of length. The 200-line recommendation is for adherence quality, not a hard cutoff.
- **MEMORY.md** has a **hard 200-line cutoff** — content past line 200 is silently dropped. This is the one with a real limit.
- **Path-scoped rules** trigger when Claude **reads** a matching file, not on every tool use.
- MEMORY.md is stored at `~/.claude/projects/<project>/memory/` — it is **user-local, not committed to git**.

## Proposed Solution

### Approach: Balanced Simplicity

The simplicity reviewer argued for "just deduplicate, no new files." The architecture reviewer argued for full path-scoped rules. The balanced approach:

- **Do create path-scoped rules** for testing and deployment — these are the two heaviest content areas (~30 lines each) and genuinely benefit from conditional loading
- **Don't create a platforms/blotato rules file** — content is small enough to keep in CLAUDE.md architecture section
- **Do create compound-engineering.local.md** — the setup skill expects it and it configures review agents for `/ce:review`
- **Don't create docs/solutions/ preemptively** — let `/ce:compound` create it when first used
- **Do slim MEMORY.md** — but only remove clear duplicates, don't aggressively trim useful state

### Content Map — What Goes Where

| File | Purpose | Loaded | Committed to git? |
|------|---------|--------|--------------------|
| `CLAUDE.md` | Commands, workflow rules, architecture, core principles, design system | Every session (<200 lines) | Yes |
| `.claude/rules/testing.md` | Prisma mocking code, coverage details, HTTP mocking, setup.ts | When reading `src/__tests__/**` or `jest.config.*` | Yes |
| `.claude/rules/deployment.md` | SST config, CI pipeline, E2E instructions, Prisma migrations | When reading `sst.config.ts`, `.github/**`, `prisma/**`, `e2e/**` | Yes |
| `MEMORY.md` | Milestone status, key files, local dev workarounds, evolving state | Every session (first 200 lines only) | No (user-local auto-memory) |
| `compound-engineering.local.md` | Review agent config for `/ce:review` | When `/ce:review` runs | Yes (project-level, not personal) |

### New CLAUDE.md Structure (~150 lines)

Architecture strategist estimated ~139 lines with the proposed content. Here is the detailed structure:

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev           # Start dev server (Next.js with Turbopack)
npm run build         # Production build (requires all env vars)
npm run lint          # ESLint
npm run test          # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Run tests + check coverage thresholds
npm run ci:check      # Lint + typecheck + coverage (mirrors CI exactly)

# Run a single test file
npx jest src/__tests__/api/posts.test.ts

# Prisma (always run generate after schema changes)
npx prisma generate
npx prisma migrate dev --name <name>

# Local dev database (Docker)
docker compose up -d db
```

**Important:** `npm run build` will fail if any env vars from `src/env.ts` are missing. `npm run dev` uses lazy loading so missing vars only fail when routes are hit. A Husky pre-push hook runs `ci:check` automatically on every `git push`.

## Workflow

### Task Orchestration (compound-engineering)
- `/ce:brainstorm` — Explore requirements before planning (exploratory/ambiguous tasks)
- `/ce:plan` — Structured implementation plans with research (3+ steps or architectural decisions)
- `/ce:work` — Execute plans with incremental commits and verification
- `/ce:review` — Multi-agent code review (TypeScript, security, performance, architecture)
- `/ce:compound` — Document solved problems in docs/solutions/ for future reference

### When to Use What
- **Trivial fix** (one file, obvious change): just do it, run tests, done
- **Moderate task** (2-3 files, clear approach): `/ce:plan` → `/ce:work`
- **Complex/ambiguous** (architectural, multi-system): `/ce:brainstorm` → `/ce:plan` → `/ce:work` → `/ce:review`
- **Bug fix**: diagnose autonomously, fix it, run tests — stop before committing
- **After any correction**: update auto-memory with the pattern to prevent recurrence

### Hard Rules
- **Never commit or push automatically** — always wait for explicit user request
- **TDD** — write tests first, then implementation. No exceptions.
- **Run `npm run ci:check` before every push** — lint + typecheck + coverage (mirrors CI)
- **Run E2E tests locally before pushing** — catches selector/UI issues without waiting for CI
- **Verification before done** — never mark complete without proving it works (tests pass, no regressions)
- **If stuck, re-plan** — don't keep pushing when something goes sideways

### Core Principles
- **Simplicity first** — make every change as simple as possible, minimal code impact
- **No laziness** — find root causes, no temporary fixes, senior developer standards
- **Minimal impact** — only touch what's necessary, avoid introducing bugs

## Architecture

### Request lifecycle
Every API route: `getServerSession(authOptions)` → reject if no session → scope DB queries to `session.user.id`. NextAuth JWT puts DB user ID in `token.sub`, forwarded to `session.user.id` via callbacks in `src/lib/auth.ts`.

Middleware (`src/middleware.ts`) protects all routes via `withAuth`, exempting `/api/auth/*`, `/auth/signin`, `/api/test/*`, and static assets. Access restricted to `ALLOWED_EMAILS` env var.

### Database (Prisma 7 + dual adapter)
`src/lib/db.ts` selects adapter by connection string: `neon.tech` → `@prisma/adapter-neon` (Lambda); otherwise `@prisma/adapter-pg` (local/CI). No `url` field in schema.prisma — URL set in `prisma.config.ts` and at runtime via `DATABASE_URL`. Always run `npx prisma generate` after schema changes.

### Scheduler
Two EventBridge Lambda crons (not in-process):
- `src/cron/publish.ts` — every minute, publishes due SCHEDULED posts
- `src/cron/metrics.ts` — every hour, refreshes metrics for up to 50 PUBLISHED posts

**Do not change cron rates** — publisher has `concurrency: 1`, metrics capped at 50 for rate limits.

### Platform integrations (Blotato)
Unified publishing via `src/lib/blotato/`. Connect flows in `src/app/api/connect/`. Token refresh via `ensureValidToken` in `src/lib/token.ts`. OAuth tokens AES-256-GCM encrypted via `src/lib/crypto.ts`. All server-side media fetches must call `assertSafeMediaUrl()` (SSRF guard: validates URL starts with `env.AWS_S3_PUBLIC_URL`).

### AI
`src/lib/ai/index.ts` uses `claude-sonnet-4-6`. `generatePostContent()` generates platform-aware post copy.

### Infrastructure (SST v3 Ion)
`sst.config.ts`: Next.js on Lambda/CloudFront, S3 bucket, two EventBridge crons, 14 SST secrets from SSM Parameter Store. Secrets mapped to Lambda env vars explicitly (not via `link`).

## Testing

Tests in `src/__tests__/` mirroring `src/` structure, `node` environment. Coverage: 75% statements/lines/branches, 70% functions. Always create/update tests when modifying covered code. See `.claude/rules/testing.md` for mocking patterns and coverage exclusions.

**Prisma mock pattern** — copy this exactly:
```ts
import { prismaMock } from "@/__tests__/mocks/prisma";
jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
beforeEach(() => mockReset(prismaMock));
```

**HTTP mocking:** spy on `global.fetch` — do not use `msw` or other interceptors.

## Deployment

`staging` branch → staging | `main` branch → production. See `.claude/rules/deployment.md` for full CI pipeline, E2E setup, and SST details.

## Design System
- Dark mode: `class="dark"` on `<html>`
- Colors: bg-zinc-950 (page), bg-zinc-900 (sidebar), bg-zinc-800 (cards), violet-600 (accent)
- Platforms: Twitter=sky-400, Instagram=pink-500, Facebook=blue-500, TikTok=zinc-100, YouTube=red-500
- Status: emerald=published, amber=scheduled, red=failed, zinc=draft

## Project Config
project_tracker: github
```

**Line count estimate: ~150 lines** (60 lines of headroom under the 200-line recommendation)

### Research Insights on CLAUDE.md Content

**From architecture strategist:**
- The Prisma mock pattern (4 lines of code) **must** stay in CLAUDE.md. When Claude writes an API route and its tests simultaneously, the test file hasn't been read yet, so path-scoped testing rules won't fire. The mock pattern prevents the single most common mistake in this codebase.
- The env var list was removed from the architecture section — it's reference material already in `src/env.ts` itself.

**From pattern recognition specialist:**
- CLAUDE.md summaries reference rules files without duplicating specific values (e.g., "See `.claude/rules/testing.md` for mocking patterns" instead of repeating the coverage exclusion list). This avoids dual source-of-truth.
- Instructions are written as **atomic, self-contained rules** rather than narrative prose. Each rule is independently actionable.

**From Anthropic docs:**
- Every line in CLAUDE.md consumes context on every session. The litmus test: "Would removing this cause Claude to make mistakes?" If not, cut it.
- Use emphasis ("IMPORTANT", bold) for critical rules — improves adherence.
- CLAUDE.md **fully survives `/compact`** — re-read from disk and re-injected fresh. Rules files behave the same way.

### Path-Scoped Rules Files

#### `.claude/rules/testing.md`

```markdown
---
paths:
  - "src/__tests__/**"
  - "jest.config.*"
---

# Testing Conventions

## Setup
`src/__tests__/setup.ts` runs via `setupFiles` (before module import) to populate env vars so `src/env.ts` Zod parse doesn't throw. `AWS_S3_PUBLIC_URL` is set to `https://storage.example.com` — test media URLs must use this prefix to pass the SSRF guard.

## Coverage Thresholds (enforced in CI)
75% statements/lines/branches, 70% functions.

### Excluded from coverage
`src/components/**`, `src/cron/**`, `src/lib/auth.ts`, `src/lib/db.ts`, `src/lib/storage.ts`, `src/lib/utils.ts`, pages, layouts, shadcn/ui, providers, types.

## Mocking
- Prisma: use `prismaMock` from `@/__tests__/mocks/prisma.ts` (pattern in CLAUDE.md)
- HTTP: spy on `global.fetch` — do NOT use `msw` or other interceptors
- All tests run in `node` environment (not jsdom)
```

#### `.claude/rules/deployment.md`

```markdown
---
paths:
  - "sst.config.ts"
  - ".github/**"
  - "prisma/**"
  - "e2e/**"
  - "playwright.config.*"
---

# Deployment & Infrastructure

## CI Pipeline
`.github/workflows/ci.yml`: lint → typecheck → unit tests → E2E tests → `prisma migrate deploy` → `sst deploy --stage $STAGE`. Deploy only runs on `main`/`staging` pushes. Concurrency group (`deploy-${{ github.ref }}`) prevents race conditions.

## SST v3 Ion
`sst.config.ts`: Next.js on Lambda/CloudFront (`sst.aws.Nextjs`), S3 bucket, two EventBridge crons, 14 secrets from SSM Parameter Store. `sst.d.ts` provides type stubs for `tsc --noEmit`.

## E2E Tests (Playwright)
Auth bypassed via `PLAYWRIGHT_E2E=true` env var → `/api/test/session` endpoint.

### Running locally
1. Docker Postgres running (`docker compose up -d db`)
2. Seed: `DATABASE_URL="postgresql://postgres:localdev@localhost:5432/ai_social?sslmode=disable" npx tsx prisma/seed.ts`
3. Start dev server: `PLAYWRIGHT_E2E=true npm run dev` (separate terminal)
4. Run: `npx playwright test`

### Gotchas
- Local DB URL **must include** `?sslmode=disable`
- Playwright `webServer.env` overrides `.env.local` (process.env takes precedence)
- If Turbopack subprocess panics, start server manually first (`reuseExistingServer: true`)

## Prisma Migrations
- `npx prisma migrate dev --name <name>` for local development
- `npx prisma migrate deploy` in CI/production
- No `url` field in schema.prisma — URL in `prisma.config.ts` for CLI, `DATABASE_URL` at runtime

## Env Validation
`src/env.ts` runs synchronous Zod parse at import time. Required vars: DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, GOOGLE_CLIENT_ID/SECRET, TWITTER_CLIENT_ID/SECRET, META_APP_ID/SECRET, ANTHROPIC_API_KEY, TIKTOK_CLIENT_ID/SECRET, TOKEN_ENCRYPTION_KEY, ALLOWED_EMAILS. Optional: AWS_S3_BUCKET, AWS_S3_PUBLIC_URL (injected by SST).
```

### Research Insights on Rules Files

**From official docs:** Rules use `paths:` frontmatter field (not `globs:`). Patterns support `**/*.ts`, `*.md`, brace expansion `*.{ts,tsx}`. Files in `.claude/rules/` are discovered recursively.

**From architecture strategist:** The deployment.md rule covers E2E content (playwright.config.*, e2e/**) — this addresses the gap where E2E workflow instructions had no proposed home. Previously, sharp-edge E2E notes (subprocess panics, sslmode, env layering) only lived in MEMORY.md.

**From pattern recognition specialist:** The original plan conflated SST, CI, and Prisma under deployment.md. While splitting into separate files was considered, the content is interconnected (CI triggers migrations, SST deploys the app) and the total volume is manageable in one file. The added E2E paths complete the deployment lifecycle coverage.

### compound-engineering.local.md

Per the compound-engineering setup skill, this file uses YAML frontmatter to configure review agents:

```markdown
---
review_agents: [kieran-typescript-reviewer, code-simplicity-reviewer, security-sentinel, performance-oracle]
plan_review_agents: [kieran-typescript-reviewer, code-simplicity-reviewer]
---

# Review Context

- Next.js 16 App Router with TypeScript, deployed on AWS Lambda via SST v3 Ion
- Prisma 7 with dual adapter (Neon WebSocket for Lambda, pg.Pool for local/CI)
- All API routes require auth via `getServerSession` — scope queries to `session.user.id`
- OAuth tokens are AES-256-GCM encrypted — review crypto usage carefully
- Platform publishing via Blotato unified API — check SSRF guards on media URLs
- Dark mode only, Tailwind v4 + shadcn/ui (canary)
```

**Note:** This replaces the existing `compound-engineering.local.md` which still references Railway (stale after SST migration). File should be committed to git since it contains project-level config, not personal preferences.

### MEMORY.md Cleanup

**Important:** MEMORY.md is user-local auto-memory at `~/.claude/projects/<project>/memory/MEMORY.md`. It is not committed to git. This cleanup is a manual editing step.

**Remove (now in CLAUDE.md or rules files):**
- Commands / npm scripts (in CLAUDE.md)
- Testing & CI rules (in CLAUDE.md Hard Rules + rules/testing.md)
- Deployment rules (in CLAUDE.md + rules/deployment.md)
- Infrastructure details (in rules/deployment.md)
- Env vars (in rules/deployment.md)
- Design system (in CLAUDE.md)
- Workflow preferences (in CLAUDE.md Hard Rules)
- E2E testing instructions (in rules/deployment.md)

**Keep (evolving state):**
- Project overview (1-2 lines)
- GitHub URL
- Stack list
- Milestone status (changes per PR)
- Key files index (evolves as code changes)
- Running the app locally (workarounds that may change)
- Prisma 7 notes (useful quick reference)
- CI debug loop pattern (`gh run watch` → `gh run view --log-failed`)

**Target: ~80 lines** (well under the 200-line hard cutoff)

### Files to Delete

1. **`.claude/CLAUDE_TEST.md`** — draft content absorbed into new CLAUDE.md workflow section

### Cleanup: Stale Railway References

**From pattern recognition specialist:** `.claude/settings.local.json` still contains Railway-specific bash permissions (`railway up`, `railway status`, etc.). Remove these while restructuring.

## Key Decisions

### Drop `tasks/todo.md` and `tasks/lessons.md` pattern
The CLAUDE_TEST.md draft uses `tasks/todo.md` for planning and `tasks/lessons.md` for learnings. compound-engineering already manages these:
- Plans → `docs/plans/` (9 files already exist)
- Learnings → `docs/solutions/` (via `/ce:compound`, directory created on first use)
- Self-improvement → auto-memory (Claude's built-in mechanism)

Having two competing systems creates contradictory instructions. Use compound-engineering's conventions exclusively.

### Rewrite "subagent strategy" as compound-engineering commands
The CLAUDE_TEST.md "Use subagents liberally" conflicts with Claude Code's system constraints. Claude Code manages subagents internally — the user-facing mechanism is through `/ce:` commands. Reframe as: "Use compound-engineering commands to parallelize research and review."

### "Autonomous bug fixing" means "fix code + run tests, stop before commit"
Resolves the tension between "just fix it" and "never auto-commit." Claude should be fully autonomous in diagnosis and fixing but always pause for explicit commit approval.

### Design system goes in CLAUDE.md, not a rule file
The color palette is only 4 lines and applies to ALL component work (not just a specific path). At 4 lines the cost is negligible versus the reliability of always having it loaded.

### Prisma mock pattern stays in CLAUDE.md
Architecture strategist flagged: when Claude writes an API route AND its tests in the same session, the route file is read first. If the mock pattern only lives in path-scoped rules/testing.md, it won't be loaded yet when Claude starts writing tests. The 4-line snippet is worth the always-loaded space.

### Two rules files, not three
Simplicity reviewer flagged 3 rules files as over-engineered. Platforms/Blotato content is small enough to keep in CLAUDE.md's architecture section. Testing and deployment have the most content and benefit most from conditional loading.

### Don't create docs/solutions/ preemptively
The simplicity reviewer correctly identified this as YAGNI. `/ce:compound` will create the directory when first used. No need to create empty scaffolding.

### compound-engineering.local.md committed to git (without `.local` in name)
Pattern recognition flagged: `.local.md` implies personal/gitignored, but review agent configuration is project-level. Consider naming it `compound-engineering.md` instead. However, the compound-engineering plugin specifically looks for `compound-engineering.local.md`, so keep that name and commit it.

## Acceptance Criteria

- [x] CLAUDE.md is under 200 lines (111 lines) with: commands, workflow orchestration, hard rules, core principles, architecture, testing summary + mock snippet, deployment summary, design system, project config
- [x] `.claude/rules/testing.md` exists (22 lines) with `paths: ["src/__tests__/**", "jest.config.*"]` containing coverage details, setup.ts behavior, exclusions
- [x] `.claude/rules/deployment.md` exists (39 lines) with `paths: ["sst.config.ts", ".github/**", "prisma/**", "e2e/**", "playwright.config.*"]` containing CI pipeline, E2E instructions, SST details, env validation, Prisma migration commands
- [x] `compound-engineering.local.md` exists (20 lines) with TypeScript review agents and correct SST/AWS context
- [x] `.claude/CLAUDE_TEST.md` is deleted
- [x] MEMORY.md manually cleaned to remove content now in CLAUDE.md/rules (68 lines, under 100 target)
- [x] No contradictory instructions across files (no Railway references, no `tasks/` references, no duplicate coverage thresholds)
- [x] Stale Railway commands removed from `.claude/settings.local.json` (replaced with `gh` permission)

## Implementation Steps

This is editing text files — no phases needed. Do it in one session:

1. **Create rules files** — `.claude/rules/testing.md` and `.claude/rules/deployment.md` with content extracted from current CLAUDE.md and MEMORY.md
2. **Rewrite CLAUDE.md** — new structure with workflow section, hard rules, slimmed architecture (reflecting Blotato migration), testing summary with mock snippet, design system, project config
3. **Create compound-engineering.local.md** — review agent config with correct SST/AWS context
4. **Delete `.claude/CLAUDE_TEST.md`**
5. **Clean up MEMORY.md** — remove duplicated content (manual edit of auto-memory file)
6. **Clean `.claude/settings.local.json`** — remove stale Railway permissions
7. **Verify** — count lines, check for contradictions, confirm path-scoped rules load correctly

## Sources & References

- [Anthropic CLAUDE.md Best Practices](https://code.claude.com/docs/en/best-practices) — under 200 lines, concrete/verifiable instructions
- [Anthropic Memory Docs](https://code.claude.com/docs/en/memory) — memory hierarchy, 200-line MEMORY.md cutoff, path-scoped rules
- [compound-engineering Plugin](https://github.com/EveryInc/compound-engineering-plugin) — /ce: workflow commands
- [How Anthropic Teams Use Claude Code (PDF)](https://www-cdn.anthropic.com/58284b19e702b49db9302d5b6f135ad8871e7658.pdf)
- [Shrivu Shankar's Claude Code Guide](https://blog.sshh.io/p/how-i-use-every-claude-code-feature) — token optimization, progressive disclosure
- compound-engineering skills: create-agent-skills, orchestrating-swarms, setup (local plugin files)
- Current project files: `CLAUDE.md`, `.claude/CLAUDE_TEST.md`, `~/.claude/projects/.../memory/MEMORY.md`
