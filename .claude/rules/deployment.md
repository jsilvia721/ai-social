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
`.github/workflows/ci.yml`: schema drift check -> lint -> typecheck -> unit tests -> E2E tests -> `prisma migrate deploy` -> `sst deploy --stage $STAGE`. Deploy only runs on `main`/`staging` pushes. Concurrency group (`deploy-${{ github.ref }}`) prevents race conditions.

## SST v3 Ion
`sst.config.ts`: Next.js on Lambda/CloudFront (`sst.aws.Nextjs`), S3 bucket, five EventBridge crons, 17 secrets from SSM Parameter Store. `sst.d.ts` provides type stubs for `tsc --noEmit`.

### SST Secret Safety
- Every `new sst.Secret()` MUST either be required in all stages OR conditional: `$app.stage === "production" ? new sst.Secret("X") : null`
- Non-production stages must have fallback values in the environment mapping (e.g., `BLOTATO_API_KEY: "mock"`)
- When adding a new secret, the PR description must list the `npx sst secret set` commands needed for each stage

## Prisma Migrations

### Schema Change Workflow (CRITICAL)
After any edit to `prisma/schema.prisma`:
1. Run `npx prisma migrate dev --name <descriptive_name>` — this creates the migration SQL AND regenerates the client
2. Review the generated `migration.sql` for correctness
3. Commit `schema.prisma` AND the new `prisma/migrations/<timestamp>_<name>/` directory together

**Never run only `npx prisma generate` after schema changes** — it updates TypeScript types but does NOT create the migration SQL. The app will typecheck and tests will pass (mocked DB), but deploy will crash at runtime with `ColumnNotFound`.

CI enforces this with `prisma migrate diff --exit-code` which fails if the schema has changes not reflected in migrations.

### Neon Connection Rules
- Migrations MUST use the direct (non-pooler) Neon endpoint. Pooler URLs (`-pooler.` in hostname) don't support `pg_advisory_lock`.
- CI strips `-pooler` from `DATABASE_URL` automatically and sets `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=1` as belt-and-suspenders.
- No `url` field in schema.prisma — URL in `prisma.config.ts` for CLI, `DATABASE_URL` at runtime.

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

## Env Validation
`src/env.ts` runs synchronous Zod parse at import time. Required vars: DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, GOOGLE_CLIENT_ID/SECRET, ANTHROPIC_API_KEY, BLOTATO_API_KEY, ALLOWED_EMAILS. Optional: AWS_S3_BUCKET, AWS_S3_PUBLIC_URL (injected by SST), SES_FROM_EMAIL, ADMIN_EMAILS.

## Documented Failures
See `docs/solutions/deployment-failures/staging-deploy-failures.md` for analysis of past staging deploy failures and prevention measures.
