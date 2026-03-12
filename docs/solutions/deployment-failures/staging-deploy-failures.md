---
title: "Staging Deploy Failures: SST Secrets, Neon Advisory Locks, and Missing Prisma Migrations"
date: 2026-03-08
severity: high
problem_type: deployment_issue
category: deployment-failures
module: ci-cd / sst.config.ts / prisma
symptom: "Staging deploys fail with SecretMissingError, Neon advisory lock timeout, or runtime ColumnNotFound after successful deploy"
root_cause: "Three distinct issues — missing SST secrets in SSM, Neon pooler incompatible with advisory locks, and prisma generate used instead of prisma migrate dev"
component:
  - ci-cd
  - prisma
  - sst
tags:
  - staging
  - deploy-failure
  - sst-secrets
  - neon
  - advisory-lock
  - prisma-migration
  - ssm-parameter-store
related_prs:
  - 5
  - 12
  - 14
  - 15
  - 17
status: resolved
---

# Staging Deploy Failures

6 out of 20 staging deploys failed (30% failure rate) due to 3 distinct root causes. All have been fixed and prevention measures added.

## Root Cause 1: Missing SST Secrets (3 failures)

### Symptoms
```
SecretMissingError: Set a value for BlotatoApiKey with `sst secret set BlotatoApiKey <value>`
```
Also: `Failed to collect page data for /api/auth/[...nextauth]` when env vars are missing at build time.

### Root Cause
New features added `new sst.Secret("SecretName")` to `sst.config.ts` without ensuring the secrets existed in SSM Parameter Store for the staging stage. SST fails hard if any declared secret is missing — there's no "optional secret" concept.

### Fix
Made secrets conditional per stage in `sst.config.ts`:

```typescript
blotatoApiKey: $app.stage === "production" ? new sst.Secret("BlotatoApiKey") : null,
sesFromEmail:  $app.stage === "production" ? new sst.Secret("SesFromEmail") : null,

// In environment mapping, provide fallbacks:
...(secrets.blotatoApiKey
  ? { BLOTATO_API_KEY: secrets.blotatoApiKey.value }
  : { BLOTATO_API_KEY: "mock" }),
```

And marked stage-optional vars as `.optional()` in `src/env.ts`.

### Why It Wasn't Caught
Production had all secrets set. Local dev uses `.env.local`. The gap only appeared when deploying to staging, which had a minimal secret set.

---

## Root Cause 2: Neon Advisory Lock Timeout (2 failures)

### Symptoms
```
P1002: The database server was reached but timed out.
Context: Timed out trying to acquire a postgres advisory lock (SELECT pg_advisory_lock(72707369)). Timeout: 10000ms.
```

### Root Cause
Prisma migrations acquire a `pg_advisory_lock` to prevent concurrent execution. Neon's connection pooler (PgBouncer in transaction mode) does not support session-level advisory locks. The `STAGING_DATABASE_URL` GitHub secret was using the pooler endpoint (`-pooler.` in hostname).

### Fix
Two changes in `.github/workflows/ci.yml`:

```yaml
- name: Run DB migrations (staging)
  env:
    DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
    PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1"
  run: |
    # Strip -pooler from hostname to use direct Neon connection
    export DATABASE_URL="${DATABASE_URL//-pooler./\.}"
    npx prisma migrate deploy
```

1. String substitution converts pooler URL to direct URL
2. `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK=1` as belt-and-suspenders (safe because CI concurrency groups prevent parallel deploys)

### Why It Wasn't Caught
Local dev uses Docker PostgreSQL (supports advisory locks). Production was configured with the direct endpoint from the start.

---

## Root Cause 3: Missing Prisma Migration (1 runtime failure)

### Symptoms
Deploy succeeded, but at runtime:
```
PrismaClientKnownRequestError P2022: The column `(not available)` does not exist in the current database (ColumnNotFound)
```
White screen: "Application error: a server-side exception has occurred while loading" (digest 4045194614).

### Root Cause
The Milestone 3 commit added columns (`topicPillar`, `tone` on Post; `formatMix`, `optimalTimeWindows`, `lastOptimizedAt` on ContentStrategy) and the `StrategyDigest` model to `schema.prisma`, then ran `npx prisma generate` to update the client. But `npx prisma migrate dev` was never run to create the actual migration SQL. Without a migration file, `prisma migrate deploy` in CI had nothing to apply, so the database schema was out of sync.

### Fix
Created migration `prisma/migrations/20260308040000_add_m3_strategy_optimizer/migration.sql` with the missing `ALTER TABLE` and `CREATE TABLE` statements (PR #17).

### Why It Wasn't Caught
- `prisma generate` only generates TypeScript types — it doesn't check the database
- `npm run build` passed because types matched the schema
- `prisma migrate deploy` passed because there were no pending migration files
- Tests use a mocked Prisma client (`prismaMock`), so they never hit a real database
- No CI step compared schema against migration history

---

## Prevention Measures Implemented

### 1. CI: Prisma Schema/Migration Drift Check (P0)

Added to CI pipeline — catches missing migrations before deploy:

```yaml
- name: Check Prisma schema/migration sync
  run: |
    npx prisma migrate diff \
      --from-migrations prisma/migrations \
      --to-schema-datamodel prisma/schema.prisma \
      --exit-code
```

Exits non-zero if the schema has changes not reflected in migrations. Requires no database connection.

### 2. CLAUDE.md Hard Rule (P0)

Added migration requirement to Hard Rules:
> Every `schema.prisma` change MUST have a migration — run `npx prisma migrate dev --name <name>`, not just `npx prisma generate`.

### 3. Deployment Rules Update (P1)

Updated `.claude/rules/deployment.md` with:
- SST secret safety rules (conditional secrets, fallback values)
- Neon connection rules (direct vs pooler)
- Migration workflow (the correct command sequence)

### 4. Pre-push Hook Enhancement (P1)

Added `prisma migrate diff --exit-code` to Husky pre-push hook for local catching.

---

## Key Lessons

1. **`prisma generate` is not `prisma migrate dev`** — The most dangerous gap. Generate updates types; migrate dev creates the migration SQL. Always use `migrate dev` after schema changes.

2. **Mock-heavy test suites can't catch schema drift** — When all DB access is mocked, runtime column errors are invisible. The CI drift check is essential.

3. **SST secrets must be stage-aware** — Every new secret needs either a conditional declaration or documented setup instructions for all stages.

4. **Neon pooler != direct connection** — Migrations, DDL, and advisory locks require the direct (non-pooler) endpoint.
