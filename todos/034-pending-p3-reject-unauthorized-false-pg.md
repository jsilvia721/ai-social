---
status: complete
priority: p3
issue_id: "034"
tags: [code-review, security, database, tls]
dependencies: []
---

# `rejectUnauthorized: false` on pg pool disables TLS certificate verification

## Problem Statement

`src/lib/db.ts` connects to non-Neon Postgres databases with `ssl: { rejectUnauthorized: false }`. TLS is used for encryption in transit but the server certificate is not verified, making the connection vulnerable to a machine-in-the-middle attack where an attacker presents a self-signed certificate and intercepts database traffic (credentials, query results, user data).

The original motivation was Railway's PostgreSQL proxy which used a self-signed cert. Since Railway is being decommissioned, this setting is tech debt.

In the post-migration architecture, the pg pool path is only used for CI (`sslmode=disable`) and local Docker (`sslmode=disable`). The `rejectUnauthorized: false` branch is only hit if someone points `DATABASE_URL` at a TLS-enabled non-Neon Postgres without `sslmode=disable` — an edge case.

## Findings

- **File:** `src/lib/db.ts:26-29`
  ```typescript
  const sslDisabled = connectionString.includes("sslmode=disable");
  const pool = new pg.Pool({
    connectionString,
    ...(sslDisabled ? {} : { ssl: { rejectUnauthorized: false } }),
  });
  ```
- Affects any non-Neon Postgres with TLS enabled
- Original Railway requirement — Railway is being removed
- Confirmed by: Security Sentinel (Finding 9)

## Proposed Solutions

### Option A: Default to `rejectUnauthorized: true`, relax via env var
```typescript
const ssl = sslDisabled
  ? false
  : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false" };
```
- Require any environment that needs a self-signed cert to explicitly opt out
- Pros: Secure by default; explicit opt-out is visible in config
- Effort: Small | Risk: None (no current use case requires the bypass)

### Option B: Remove non-Neon SSL entirely
- Since all production traffic uses Neon and all CI/dev uses `sslmode=disable`, the `rejectUnauthorized: false` path is never hit
- Remove the ternary; set `ssl: false` when `sslmode=disable`, `ssl: true` otherwise
- Pros: Simplest; eliminates the bad default
- Effort: Tiny | Risk: None

### Option C: Leave as-is — edge case with no current exploit path
- The bypass is only reached if someone uses a TLS-enabled custom Postgres without `sslmode=disable`
- This does not apply to any current environment
- Pros: No change
- Effort: None | Risk: Low (theoretical, not practical)

## Recommended Action

Option B — clean up Railway-era tech debt while the file is being touched.

## Technical Details

- **Affected files:** `src/lib/db.ts`

## Acceptance Criteria

- [ ] `rejectUnauthorized: false` removed or gated behind explicit env var
- [ ] CI and local dev: `sslmode=disable` path unaffected
- [ ] Production: Neon path unaffected (uses WebSocket adapter, not pg pool)

## Work Log

- 2026-03-06: Identified by Security Sentinel during AWS migration PR review. Railway tech debt.

## Resources

- PR #2: feat/aws-sst-migration
