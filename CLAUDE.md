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

# Prisma (always run migrate dev after schema changes — not just generate)
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
- **Moderate task** (2-3 files, clear approach): `/ce:plan` -> `/ce:work`
- **Complex/ambiguous** (architectural, multi-system): `/ce:brainstorm` -> `/ce:plan` -> `/ce:work` -> `/ce:review`
- **Bug fix**: diagnose autonomously, fix it, run tests — stop before committing
- **After any correction**: update auto-memory with the pattern to prevent recurrence

### Hard Rules
- **Never commit or push automatically** — always wait for explicit user request
- **TDD** — write tests first, then implementation. No exceptions.
- **Run `npm run ci:check` before every push** — lint + typecheck + coverage (mirrors CI)
- **Run E2E tests locally before pushing** — catches selector/UI issues without waiting for CI
- **Verification before done** — never mark complete without proving it works (tests pass, no regressions)
- **Always branch from `origin/staging`** — run `git fetch origin` first, then `git checkout -b <branch> origin/staging` or `git worktree add ... origin/staging`. Never branch from the current HEAD or another feature branch. Before creating a PR, run `git fetch origin && git merge origin/staging` to surface conflicts locally.
- **If stuck, re-plan** — don't keep pushing when something goes sideways
- **Every `schema.prisma` change MUST have a migration** — run `npx prisma migrate dev --name <name>`, never just `npx prisma generate`. CI enforces this with `prisma migrate diff --exit-code`.
- **New SST secrets require environment setup** — when adding a `new sst.Secret()` to `sst.config.ts`, the PR description MUST list every new secret and the exact `npx sst secret set <Name> "<value>" --stage staging` and `--stage production` commands. If the secret isn't ready, make it optional (set to `null` in sst.config.ts, `z.string().optional()` in env.ts) following the BlotatoApiKey pattern. See `docs/solutions/deployment-issues/sst-secret-not-set-causes-deploy-failure.md`.

### Branching & Worktrees
- **Always branch from `staging`** — run `git fetch origin staging` then branch from `origin/staging`. PRs target `staging`, not `main`.
- **Worktree creation** — use `git worktree add .claude/worktrees/<name> -b <branch> origin/staging` to create worktrees with the correct base in one step.
- **Never stash across bases** — do not `git stash` on one branch and pop on a branch with a different base. This causes merge conflicts. Instead, commit WIP on the current branch, create a new branch from the correct base, and cherry-pick or re-apply changes.
- **Verify before PR** — run `git merge-base --is-ancestor origin/staging HEAD` to confirm your branch descends from staging before pushing.

### Core Principles
- **Simplicity first** — make every change as simple as possible, minimal code impact
- **No laziness** — find root causes, no temporary fixes, senior developer standards
- **Minimal impact** — only touch what's necessary, avoid introducing bugs

## Architecture

### Request lifecycle
Every API route: `getServerSession(authOptions)` -> reject if no session -> scope DB queries to `session.user.id`. NextAuth JWT puts DB user ID in `token.sub`, forwarded to `session.user.id` via callbacks in `src/lib/auth.ts`.

Middleware (`src/middleware.ts`) protects all routes via `withAuth`, exempting `/api/auth/*`, `/auth/signin`, `/api/test/*`, and static assets. Access restricted to `ALLOWED_EMAILS` env var.

### Database (Prisma 7 + dual adapter)
`src/lib/db.ts` selects adapter by connection string: `neon.tech` -> `@prisma/adapter-neon` (Lambda); otherwise `@prisma/adapter-pg` (local/CI). No `url` field in schema.prisma — URL set in `prisma.config.ts` and at runtime via `DATABASE_URL`. After schema changes, run `npx prisma migrate dev --name <name>` (creates migration + regenerates client).

### Scheduler
Two EventBridge Lambda crons (not in-process):
- `src/cron/publish.ts` — every minute, publishes due SCHEDULED posts
- `src/cron/metrics.ts` — every hour, refreshes metrics for up to 50 PUBLISHED posts

**Do not change cron rates** — publisher has `concurrency: 1`, metrics capped at 50 for rate limits.

### Platform integrations (Blotato)
Unified publishing via `src/lib/blotato/`. Connect flows in `src/app/api/connect/`. Token refresh via `ensureValidToken` in `src/lib/token.ts`. OAuth tokens AES-256-GCM encrypted via `src/lib/crypto.ts`. All server-side media fetches must call `assertSafeMediaUrl()` (SSRF guard: validates URL starts with `env.AWS_S3_PUBLIC_URL`).

### File uploads
`src/lib/storage.ts` wraps AWS S3. Two upload paths: direct server-side via `POST /api/upload` and browser-direct via presigned URL from `GET /api/upload/presigned`.

### AI
`src/lib/ai/index.ts` uses `claude-sonnet-4-6`. `generatePostContent()` generates platform-aware post copy.

### Infrastructure (SST v3 Ion)
`sst.config.ts`: Next.js on Lambda/CloudFront, S3 bucket, two EventBridge crons, 14 SST secrets from SSM Parameter Store. Secrets mapped to Lambda env vars explicitly (not via `link`).

## Testing

Tests in `src/__tests__/` mirroring `src/` structure, `node` environment. Coverage: 75% statements/lines/branches, 70% functions. Always create/update tests when modifying covered code. See `.claude/rules/testing.md` for coverage exclusions and setup details.

**Prisma mock pattern** — copy this exactly:
```ts
import { prismaMock } from "@/__tests__/mocks/prisma";
jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
beforeEach(() => mockReset(prismaMock));
```

**HTTP mocking:** spy on `global.fetch` — do not use `msw` or other interceptors.

## Deployment

`staging` branch -> staging | `main` branch -> production. See `.claude/rules/deployment.md` for CI pipeline, E2E setup, and SST details.

## Design System
- Dark mode: `class="dark"` on `<html>`
- Colors: bg-zinc-950 (page), bg-zinc-900 (sidebar), bg-zinc-800 (cards), violet-600 (accent)
- Platforms: Twitter=sky-400, Instagram=pink-500, Facebook=blue-500, TikTok=zinc-100, YouTube=red-500
- Status: emerald=published, amber=scheduled, red=failed, zinc=draft

## Project Config
project_tracker: github
