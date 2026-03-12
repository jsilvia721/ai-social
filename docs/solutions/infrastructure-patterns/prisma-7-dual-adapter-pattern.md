---
title: Prisma 7 Dual Adapter Pattern for Multi-Environment Database Connectivity
date: 2026-03-12
category: infrastructure-patterns
severity: informational
module: src/lib/db.ts
symptom: "Prisma client initialization varies by database connection type (Neon vs PostgreSQL)"
root_cause: "Prisma 7 removed the url field from schema.prisma datasource block, requiring runtime adapter selection and explicit URL configuration"
component:
  - src/lib/db.ts
  - prisma/schema.prisma
  - prisma.config.ts
tags:
  - prisma-7
  - dual-adapter
  - neon
  - postgres
  - lambda
  - serverless
  - database
  - configuration
status: implemented
---

# Prisma 7 Dual Adapter Pattern

## Problem & Context

Prisma 7 fundamentally changed how database adapters are configured. The `schema.prisma` file no longer accepts a `url` field in the datasource block — it only specifies the provider as `"postgresql"`. Instead, the database URL is sourced at runtime via environment variables and `prisma.config.ts`, with adapter selection determined by the connection string's hostname.

The ai-social application implements this pattern to support two distinct deployment models:
- **AWS Lambda / production**: Neon WebSocket adapter (`@prisma/adapter-neon`) for serverless
- **Local development / CI**: Standard pg.Pool adapter (`@prisma/adapter-pg`) for traditional PostgreSQL

The pattern detects `neon.tech` in `DATABASE_URL` at runtime and instantiates the appropriate adapter.

## Solution

### 1. Adapter Selection (`src/lib/db.ts`)

```typescript
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import { PrismaClient } from "@prisma/client";
import pg from "pg";
import ws from "ws";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL!;
  const log: ("query" | "error" | "warn")[] =
    process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"];

  // Neon serverless (production): use WebSocket adapter
  if (connectionString.includes("neon.tech")) {
    neonConfig.webSocketConstructor = ws;
    const adapter = new PrismaNeon({ connectionString });
    return new PrismaClient({ adapter, log });
  }

  // Local/CI PostgreSQL: use standard pg.Pool adapter
  const sslDisabled = connectionString.includes("sslmode=disable");
  const rejectUnauthorized = process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false";
  const pool = new pg.Pool({
    connectionString,
    ...(sslDisabled ? {} : { ssl: { rejectUnauthorized } }),
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter, log });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

### 2. Schema Configuration (`prisma/schema.prisma`)

```prisma
datasource db {
  provider = "postgresql"
}
```

No `url` field. This is a Prisma 7 requirement — the URL is configured externally.

### 3. Migration URL (`prisma.config.ts`)

```typescript
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    // Prefer DIRECT_URL for migrations (bypasses connection pooler)
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
  },
});
```

### 4. Environment Matrix

| Environment | URL Source | Adapter | Connection Type |
|---|---|---|---|
| Local dev | `DATABASE_URL` (Docker Postgres) | `PrismaPg` | Direct pg.Pool |
| CI: typecheck | Dummy URL | N/A (generate only) | N/A |
| CI: E2E tests | `DATABASE_URL` (service Postgres) | `PrismaPg` | Direct pg.Pool |
| Staging deploy | `STAGING_DATABASE_URL` (direct Neon) | N/A (CLI migrate) | Direct |
| Staging runtime | `DATABASE_URL` (Neon) | `PrismaNeon` | WebSocket |
| Production deploy | `PROD_DATABASE_URL` (direct Neon) | N/A (CLI migrate) | Direct |
| Production runtime | `DATABASE_URL` (Neon) | `PrismaNeon` | WebSocket |

### 5. CI Enforcement

The CI pipeline enforces schema/migration synchronization:

```yaml
- name: Check Prisma schema has matching migration
  run: |
    CHANGED=$(git diff --name-only "$BASE_SHA" HEAD)
    if echo "$CHANGED" | grep -q "prisma/schema.prisma"; then
      if ! echo "$CHANGED" | grep -q "prisma/migrations/"; then
        echo "::error::prisma/schema.prisma was modified but no new migration was added."
        exit 1
      fi
    fi
```

If `schema.prisma` changed but no migration file was added, CI fails.

## Common Mistakes to Avoid

1. **Adding `url` to `schema.prisma`** — Prisma 7 does not support this. URL is configured in `prisma.config.ts` and at runtime.
2. **Running `npx prisma generate` instead of `npx prisma migrate dev`** — `generate` only updates TypeScript types. `migrate dev` creates migration SQL, applies it, AND regenerates the client.
3. **Using a pooler URL for migrations** — Neon pooler (PgBouncer in transaction mode) does not support advisory locks required by Prisma migrations. Always use the direct endpoint.
4. **Using `prisma db push` in production** — This is for prototyping only. Use `prisma migrate deploy` for versioned migrations.
5. **Forgetting to commit migration files** — Both `prisma/schema.prisma` and `prisma/migrations/` must be committed together.

## Correct Command Sequence for Schema Changes

```bash
# 1. Edit prisma/schema.prisma

# 2. Create migration + apply + regenerate client
npx prisma migrate dev --name <descriptive_name>

# 3. Verify
npm run test
npm run ci:check

# 4. Commit both schema and migration
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: <description>"
```

## Prevention & Best Practices

- **Always use `migrate dev` after schema changes** — never just `generate`. CI enforces this.
- **Use `DIRECT_URL` for migrations in CI/CD** — `prisma.config.ts` already prefers this.
- **Test with both adapter paths** — local Docker exercises `PrismaPg`, staging/production exercises `PrismaNeon`.
- **E2E tests use a real database** — unit tests mock Prisma, but E2E tests hit actual Postgres to verify adapter behavior.
- **The `globalForPrisma` pattern** prevents multiple client instances during Next.js hot-reload. In Lambda, module caching handles this naturally.

## Cross-References

- [CLAUDE.md - Database section](/CLAUDE.md) — Architecture overview of the dual adapter
- [.claude/rules/deployment.md](/claude/rules/deployment.md) — Migration workflow, Neon connection rules
- [.claude/rules/testing.md](/.claude/rules/testing.md) — Prisma mock pattern for unit tests
- [docs/solutions/deployment-failures/staging-deploy-failures.md](../deployment-failures/staging-deploy-failures.md) — Root Cause 2 (Neon advisory lock) and Root Cause 3 (missing migration)
