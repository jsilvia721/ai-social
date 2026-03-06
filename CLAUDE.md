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

# Run a single test file
npx jest src/__tests__/api/posts.test.ts

# Prisma (always run generate after schema changes)
npx prisma generate
npx prisma migrate dev --name <name>
npx prisma db push    # Push schema without migration file
```

**Important:** `npm run build` will fail if any env vars from `src/env.ts` are missing. `npm run dev` uses lazy loading so missing vars only fail when routes are hit.

## Architecture

### Request lifecycle
Every API route follows the same pattern: call `getServerSession(authOptions)` → reject if no session → scope all DB queries to `session.user.id`. The NextAuth JWT strategy puts the DB user ID in `token.sub`, which is forwarded to `session.user.id` via callbacks in `src/lib/auth.ts`.

Middleware (`src/middleware.ts`) protects all routes via `withAuth`, exempting only `/api/auth/*`, `/auth/signin`, and static assets.

Access is restricted to emails listed in the `ALLOWED_EMAILS` env var (comma-separated), enforced in the `signIn` callback in `src/lib/auth.ts`.

### Env validation
`src/env.ts` runs a synchronous Zod parse of `process.env` at import time. Any missing var crashes the process immediately with a clear error. All required vars: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET`, `META_APP_ID`, `META_APP_SECRET`, `ANTHROPIC_API_KEY`, `ALLOWED_EMAILS`.

### Database (Prisma 7 + pg.Pool)
`src/lib/db.ts` creates a `PrismaClient` using the `PrismaPg` adapter backed by a `pg.Pool`. The `datasource` block in `prisma/schema.prisma` has **no `url` field** — the URL is set only in `prisma.config.ts` (for CLI migrations) and at runtime via `DATABASE_URL` env var. SSL is automatically disabled when `sslmode=disable` appears in the connection string; otherwise it connects with `rejectUnauthorized: false` (required for Railway's proxy cert).

### Scheduler
`src/instrumentation.ts` (Next.js instrumentation hook) starts the cron scheduler on server boot in Node.js runtime only. Two cron jobs run:
- Every minute: `runScheduler()` — publishes due SCHEDULED posts via platform APIs, marks them PUBLISHED or FAILED
- Every hour: `runMetricsRefresh()` — fetches engagement metrics for PUBLISHED posts

Token refresh happens in `src/lib/token.ts` (`ensureValidToken`). Twitter tokens are refreshed via OAuth; Meta page tokens never expire.

### Platform integrations
- `src/lib/platforms/twitter/index.ts` — Twitter API v2 (OAuth 2.0 PKCE flow via `/api/connect/twitter`)
- `src/lib/platforms/instagram/index.ts` — Instagram Graph API (Meta OAuth via `/api/connect/meta`)
- `src/lib/platforms/facebook/index.ts` — Facebook Graph API (same Meta OAuth flow)

### AI
`src/lib/ai/index.ts` uses `@anthropic-ai/sdk` with `claude-sonnet-4-6`. `generatePostContent()` generates platform-aware post copy. `suggestOptimalTimes()` returns hardcoded defaults (placeholder for future analytics-based logic).

### File uploads
`src/lib/storage.ts` wraps AWS S3. Upload endpoint at `/api/upload`.

## Testing

Tests live in `src/__tests__/` mirroring the `src/` structure. All tests are in `node` environment (not jsdom).

**Prisma mocking pattern** — copy this exactly:
```ts
import { prismaMock } from "@/__tests__/mocks/prisma";

jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
beforeEach(() => mockReset(prismaMock));
```

**HTTP mocking:** spy on `global.fetch` — do not use `msw` or other interceptors.

**Setup:** `src/__tests__/setup.ts` runs via `setupFiles` (before any module import) to populate all env vars so `src/env.ts`'s Zod parse doesn't throw.

**Coverage thresholds** (enforced in CI): 75% statements/lines/branches, 70% functions. Excluded: components, pages, layouts, `src/lib/auth.ts`, `src/lib/db.ts`, `src/lib/storage.ts`, `src/lib/utils.ts`, shadcn/ui, providers, types. Always create/update tests when adding or modifying covered code.

`schedulePostPublisher` (dynamic `node-cron` import) is intentionally not unit-tested.

## Deployment

- `main` branch → production Railway environment (triggered by CI after tests pass)
- `staging` branch → staging Railway environment

CI pipeline: `.github/workflows/ci.yml` — runs tests → deploys via Railway CLI if on `main` or `staging`.

**Do not change the metrics/scheduler cron to run more frequently than hourly** — it caused a Railway Postgres connection storm previously.
