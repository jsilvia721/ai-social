---
status: pending
priority: p1
issue_id: "007"
tags: [code-review, database, ci-cd, neon, migration]
dependencies: []
---

# P1 — `DIRECT_URL` Not Wired Into CI Migration Deploy Steps

## Problem Statement

Neon requires a non-pooled (direct) connection string for `prisma migrate deploy`. The plan mentions `STAGING_DIRECT_DATABASE_URL` and `PROD_DIRECT_DATABASE_URL` as GitHub secrets, but the current `.github/workflows/ci.yml` migration steps use `DATABASE_URL` (the pooled connection). If the Phase 3 CI update only adds `DIRECT_URL` to the E2E block (as implied), the production migration steps will continue using the pooled URL — which will timeout or error on Neon for schema-altering migrations.

## Findings

- Source: data-migration-expert (Finding 4)
- Confirmed by inspecting current `ci.yml`: migration steps use `DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}` — pooled
- Neon's pooler does not support session-level DDL commands reliably
- `prisma.config.ts` also needs updating to prefer `DIRECT_URL` when set

## Proposed Solutions

### Option A — Update CI migration steps to use direct URL (Recommended)
```yaml
- name: Run DB migrations (production)
  if: github.ref == 'refs/heads/main'
  env:
    DATABASE_URL: ${{ secrets.PROD_DIRECT_DATABASE_URL }}
  run: npx prisma migrate deploy

- name: Run DB migrations (staging)
  if: github.ref == 'refs/heads/staging'
  env:
    DATABASE_URL: ${{ secrets.STAGING_DIRECT_DATABASE_URL }}
  run: npx prisma migrate deploy
```

Also update `prisma.config.ts`:
```typescript
datasource: {
  url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
},
```

And add GitHub secrets: `STAGING_DIRECT_DATABASE_URL`, `PROD_DIRECT_DATABASE_URL`

**Pros:** Correct. Matches Neon documentation.
**Effort:** Small | **Risk:** Low

## Recommended Action

Option A. Also add the two direct URL secrets to the SST secrets list if they're needed at Lambda runtime (they're not — Lambda only needs the pooled URL).

## Technical Details

- **Affected files:** `.github/workflows/ci.yml`, `prisma.config.ts`
- **Plan phase:** Phase 3 (CI/CD update)

## Acceptance Criteria

- [ ] CI migration steps use `STAGING_DIRECT_DATABASE_URL` / `PROD_DIRECT_DATABASE_URL`
- [ ] `prisma.config.ts` updated to use `DIRECT_URL` when set
- [ ] GitHub secrets `STAGING_DIRECT_DATABASE_URL` and `PROD_DIRECT_DATABASE_URL` added
- [ ] Staging migration test passes with direct URL before production deploy

## Work Log

- 2026-03-07: Identified by data-migration-expert (Finding 4) during plan review
