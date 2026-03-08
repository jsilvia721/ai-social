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
`.github/workflows/ci.yml`: lint -> typecheck -> unit tests -> E2E tests -> `prisma migrate deploy` -> `sst deploy --stage $STAGE`. Deploy only runs on `main`/`staging` pushes. Concurrency group (`deploy-${{ github.ref }}`) prevents race conditions.

## SST v3 Ion
`sst.config.ts`: Next.js on Lambda/CloudFront (`sst.aws.Nextjs`), S3 bucket, two EventBridge crons, 14 secrets from SSM Parameter Store. `sst.d.ts` provides type stubs for `tsc --noEmit`.

## E2E Tests (Playwright)
Auth bypassed via `PLAYWRIGHT_E2E=true` env var -> `/api/test/session` endpoint.

### Running locally
1. Docker Postgres running (`docker compose up -d db`)
2. Seed: `DATABASE_URL="postgresql://postgres:localdev@localhost:5432/ai_social?sslmode=disable" npx tsx prisma/seed.ts`
3. Start dev server: `PLAYWRIGHT_E2E=true npm run dev` (separate terminal)
4. Run: `npx playwright test`

### Gotchas
- Local DB URL **must include** `?sslmode=disable`
- Playwright `webServer.env` overrides `.env.local` (process.env takes precedence)
- If Turbopack subprocess panics, start server manually first (`reuseExistingServer: true`)
- CI debug loop: push -> `gh run watch {id} --exit-status --compact` -> `gh run view {id} --log-failed` -> fix -> push

## Prisma Migrations
- `npx prisma migrate dev --name <name>` for local development
- `npx prisma migrate deploy` in CI/production
- No `url` field in schema.prisma — URL in `prisma.config.ts` for CLI, `DATABASE_URL` at runtime

## Env Validation
`src/env.ts` runs synchronous Zod parse at import time. Required vars: DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, GOOGLE_CLIENT_ID/SECRET, TWITTER_CLIENT_ID/SECRET, META_APP_ID/SECRET, ANTHROPIC_API_KEY, TIKTOK_CLIENT_ID/SECRET, TOKEN_ENCRYPTION_KEY, ALLOWED_EMAILS. Optional: AWS_S3_BUCKET, AWS_S3_PUBLIC_URL (injected by SST).
