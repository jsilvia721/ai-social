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

## Architecture

### Request lifecycle
Every API route follows the same pattern: call `getServerSession(authOptions)` → reject if no session → scope all DB queries to `session.user.id`. The NextAuth JWT strategy puts the DB user ID in `token.sub`, which is forwarded to `session.user.id` via callbacks in `src/lib/auth.ts`.

Middleware (`src/middleware.ts`) protects all routes via `withAuth`, exempting only `/api/auth/*`, `/auth/signin`, `/api/test/*`, and static assets. Access is restricted to emails in the `ALLOWED_EMAILS` env var (comma-separated), enforced in the `signIn` callback.

### Env validation
`src/env.ts` runs a synchronous Zod parse of `process.env` at import time. Any missing required var crashes the process immediately. Required vars: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `ANTHROPIC_API_KEY`, `TIKTOK_CLIENT_ID`, `TIKTOK_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `ALLOWED_EMAILS`. S3 vars (`AWS_S3_BUCKET`, `AWS_S3_PUBLIC_URL`) are optional in the schema but injected automatically by SST in deployed environments.

### Database (Prisma 7 + dual adapter)
`src/lib/db.ts` selects the adapter based on the connection string: if it contains `neon.tech`, it uses `@prisma/adapter-neon` with a WebSocket connection (required for Lambda); otherwise it uses `@prisma/adapter-pg` with a `pg.Pool` (local Docker and CI). The `datasource` block in `prisma/schema.prisma` has **no `url` field** — the URL is set only in `prisma.config.ts` (for CLI migrations) and at runtime via `DATABASE_URL`. Always run `npx prisma generate` after schema changes.

### Scheduler
Scheduling runs as two AWS EventBridge-triggered Lambda functions (not in-process):
- `src/cron/publish.ts` — fires every minute, calls `runScheduler()` which publishes due `SCHEDULED` posts via platform APIs and marks them `PUBLISHED` or `FAILED`
- `src/cron/metrics.ts` — fires every hour, calls `runMetricsRefresh()` which fetches engagement metrics for up to 50 `PUBLISHED` posts (oldest-stale first)

**Do not change these crons to run more frequently than their current rates** — the publisher is rate-limited by Lambda concurrency (`concurrency: 1`) and the metrics refresh is capped at 50 posts to respect platform rate limits.

Token refresh happens in `src/lib/token.ts` (`ensureValidToken`). Each platform has its own refresh logic. OAuth tokens are stored AES-256-GCM encrypted in the database via `src/lib/crypto.ts`.

### Platform integrations
Each platform lives in `src/lib/platforms/<platform>/index.ts` and exports publish and metrics functions. Connect flows live in `src/app/api/connect/<platform>/`. All server-side fetches of user-supplied media URLs must call `assertSafeMediaUrl()` (currently inlined in each platform file) to guard against SSRF — it validates the URL starts with `env.AWS_S3_PUBLIC_URL`.

- **Twitter** — API v2, OAuth 2.0 PKCE, refresh tokens supported
- **Instagram** — Graph API, Meta OAuth (same flow as Facebook)
- **Facebook** — Graph API, Meta OAuth, long-lived page tokens (never expire)
- **TikTok** — TikTok for Developers API, PKCE flow
- **YouTube** — YouTube Data API v3, Google OAuth with refresh tokens

### File uploads
`src/lib/storage.ts` wraps AWS S3. Two upload paths exist: direct server-side upload via `POST /api/upload` and browser-direct upload via presigned URL from `GET /api/upload/presigned`. The S3 bucket IAM credentials come from the Lambda execution role — no static credentials are used.

### AI
`src/lib/ai/index.ts` uses `@anthropic-ai/sdk` with `claude-sonnet-4-6`. `generatePostContent()` generates platform-aware post copy given a brief. `suggestOptimalTimes()` returns hardcoded defaults (placeholder).

### Infrastructure (SST v3 Ion)
`sst.config.ts` defines all AWS infrastructure: Next.js on Lambda/CloudFront (`sst.aws.Nextjs`), S3 bucket, two EventBridge crons, and 14 secrets sourced from SSM Parameter Store (`sst.Secret`). Secrets are explicitly mapped into Lambda env vars in the `environment` object — SST's `link` mechanism uses `SST_RESOURCE_*` names which the app does not read. `sst.d.ts` provides type stubs so `sst.config.ts` is covered by `tsc --noEmit`.

## Testing

Tests live in `src/__tests__/` mirroring the `src/` structure. All tests run in the `node` environment (not jsdom).

**Prisma mocking pattern** — copy this exactly:
```ts
import { prismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
beforeEach(() => mockReset(prismaMock));
```

**HTTP mocking:** spy on `global.fetch` — do not use `msw` or other interceptors.

**Setup:** `src/__tests__/setup.ts` runs via `setupFiles` (before any module import) to populate all env vars so `src/env.ts`'s Zod parse doesn't throw. `AWS_S3_PUBLIC_URL` is set to `https://storage.example.com` — test media URLs must use this prefix to pass the SSRF guard.

**Coverage thresholds** (enforced in CI): 75% statements/lines/branches, 70% functions. Excluded from coverage: `src/components/**`, `src/cron/**`, `src/lib/auth.ts`, `src/lib/db.ts`, `src/lib/storage.ts`, `src/lib/utils.ts`, pages, layouts, shadcn/ui, providers, types. Always create/update tests when adding or modifying covered code.

## Deployment

- `staging` branch → staging AWS environment (SST stage: `staging`)
- `main` branch → production AWS environment (SST stage: `production`)

CI pipeline (`.github/workflows/ci.yml`): lint → typecheck → unit tests → E2E tests → `prisma migrate deploy` → `sst deploy --stage $STAGE`. Deploy only runs on `main`/`staging` pushes. The deploy job has a concurrency group (`deploy-${{ github.ref }}`) so concurrent pushes queue rather than race on migrations.

**E2E tests:** Auth is bypassed via `PLAYWRIGHT_E2E=true` env var which enables the `/api/test/session` endpoint. Before running locally: start Docker Postgres, seed with `npx tsx prisma/seed.ts`, start the dev server with `PLAYWRIGHT_E2E=true npm run dev`, then `npx playwright test`.
