# CLAUDE.md

## Commands

```bash
npm run dev           # Start dev server (Next.js with Turbopack)
npm run build         # Production build
npm run lint          # ESLint
npm run test          # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Run tests + check coverage thresholds
npm run ci:check      # Lint + typecheck + coverage (mirrors CI exactly)
npx jest src/__tests__/api/posts.test.ts  # Run a single test file
npx prisma migrate dev --name <name>      # Prisma migration (always after schema changes)
docker compose up -d db                   # Local dev database (Docker)
```

## Workflow

### Task Orchestration (compound-engineering)
- `/ce:brainstorm` — Explore requirements before planning
- `/ce:plan` — Structured implementation plans with research
- `/ce:work` — Execute plans with incremental commits and verification
- `/ce:review` — Multi-agent code review
- `/ce:compound` — Document solved problems in docs/solutions/

### Visual UI Testing
See `.claude/rules/visual-testing.md` for Playwright MCP, design-iterator, design-implementation-reviewer, and agent-browser usage.

### When to Use What
- **Trivial** (one file, obvious): fix it, run tests, done
- **Moderate** (2-5 files, clear approach): `/ce:plan` → `/ce:work`
- **Complex/ambiguous** (architectural, multi-system): `/ce:brainstorm` → `/ce:plan` → `/ce:work` → `/ce:review`

### Hard Rules
- **Never commit or push automatically** — wait for explicit user request.
- **TDD** — write tests first, then implementation. No exceptions.
- **Run `npm run ci:check` before every push** — lint + typecheck + coverage (mirrors CI).
- **Run E2E tests locally before pushing** — catches selector/UI issues without waiting for CI.
- **Verify before done** — never mark complete without proving it works (tests pass, no regressions).
- **Always branch from `origin/main`** — run `git fetch origin` first, then `git checkout -b <branch> origin/main`. Never branch from current HEAD or another feature branch. Before creating a PR, run `git fetch origin && git merge origin/main` to surface conflicts locally. **Exception:** If the work issue contains a `<!-- TARGET_BRANCH: ... -->` marker, branch from `origin/<target_branch>` instead and target the PR at that branch.
- **Create worktrees correctly** — use `git worktree add .claude/worktrees/<name> -b <branch> origin/main`. If a `TARGET_BRANCH` marker is present, use `origin/<target_branch>` as the base instead of `origin/main`.
- **Never stash across bases** — commit WIP on the current branch, create a new branch from the correct base, and cherry-pick or re-apply changes.
- **If stuck, re-plan** — don't keep pushing when something goes sideways.
- **Every `schema.prisma` change MUST have a migration** — run `npx prisma migrate dev --name <name>`, never just `npx prisma generate`. CI enforces with `prisma migrate diff --exit-code`.
- **New SST secrets require environment setup** — PR description MUST list every new secret and the exact `npx sst secret set` commands. If not ready, make optional following the BlotatoApiKey pattern. See `docs/solutions/deployment-issues/sst-secret-not-set-causes-deploy-failure.md`.
- **Always use `/create-issue` skill for GitHub issues** — never use `gh issue create` directly.
- **Workspace hygiene** — clean up temp files before finishing. Run `git status` to verify no stray files remain.
- **After any correction** — update auto-memory with the pattern to prevent recurrence.
- **Auto-compound after non-trivial work** — after completing any bug fix or Moderate+ feature, run `/ce:compound` to document the solution in `docs/solutions/` before declaring done.

### Core Principles
- **Simplicity first** — minimal code impact.
- **No laziness** — find root causes, no temporary fixes, senior developer standards.
- **Minimal impact** — only touch what's necessary.

## Architecture

### Request lifecycle
Every API route: `getServerSession(authOptions)` → reject if no session → scope DB queries to `session.user.id`. NextAuth JWT puts DB user ID in `token.sub`, forwarded to `session.user.id` via callbacks in `src/lib/auth.ts`.

Middleware (`src/middleware.ts`) protects all routes via `withAuth`, exempting `/api/auth/*`, `/auth/signin`, `/api/test/*`, and static assets. Access restricted to `ALLOWED_EMAILS` env var.

### Database (Prisma 7 + dual adapter)
`src/lib/db.ts` selects adapter by connection string: `neon.tech` → `@prisma/adapter-neon` (Lambda); otherwise `@prisma/adapter-pg` (local/CI). No `url` field in schema.prisma — URL set in `prisma.config.ts` and at runtime via `DATABASE_URL`. After schema changes, run `npx prisma migrate dev --name <name>`.

### Scheduler
Two EventBridge Lambda crons (not in-process):
- `src/cron/publish.ts` — every minute, publishes due SCHEDULED posts
- `src/cron/metrics.ts` — every hour, refreshes metrics for up to 50 PUBLISHED posts

**Do not change cron rates** — publisher has `concurrency: 1`, metrics capped at 50 for rate limits.

### Platform integrations (Blotato)
Unified publishing via `src/lib/blotato/`. Connect flows in `src/app/api/connect/`. Token refresh via `ensureValidToken` in `src/lib/token.ts`. OAuth tokens AES-256-GCM encrypted via `src/lib/crypto.ts`. All server-side media fetches must call `assertSafeMediaUrl()` (SSRF guard).

### File uploads
`src/lib/storage.ts` wraps AWS S3. Two upload paths: direct server-side via `POST /api/upload` and browser-direct via presigned URL from `GET /api/upload/presigned`.

### AI
`src/lib/ai/index.ts` uses `claude-sonnet-4-6`. `generatePostContent()` generates platform-aware post copy.

### Hooks
`.claude/hooks/` contains bash scripts that enforce Hard Rules as gates. Wired via `.claude/settings.json`. Hook scripts parse stdin JSON with `jq` and exit 2 to block dangerous operations. See individual scripts for blocked patterns.

### Feature Branch Lifecycle (Plan-Based Work)
For complex plans decomposed into multiple issues, the plan-executor creates a feature branch (`feat/plan-<number>-<slug>`) and injects a `<!-- TARGET_BRANCH: <branch> -->` marker into each child issue. Individual task PRs target the feature branch and auto-merge when CI passes. Once all child issues are closed, a final PR is created from the feature branch to `main` for human review. This keeps `main` stable while allowing incremental progress on multi-issue plans.

### Infrastructure (SST v3 Ion)
`sst.config.ts`: Next.js on Lambda/CloudFront, S3 bucket, two EventBridge crons, 14 SST secrets from SSM Parameter Store. Secrets mapped to Lambda env vars explicitly (not via `link`).

## Testing

Tests in `src/__tests__/` mirroring `src/` structure, `node` environment. Coverage: 75% statements/lines/branches, 70% functions. Always create/update tests when modifying covered code. See `.claude/rules/testing.md` for mocking patterns, coverage exclusions, and setup details.

## Deployment

PRs target `main`. Merges to `main` auto-deploy to staging; production deploy requires manual approval. See `.claude/rules/deployment.md` for CI pipeline, E2E setup, env validation, and SST details.

## Project Config
project_tracker: github
