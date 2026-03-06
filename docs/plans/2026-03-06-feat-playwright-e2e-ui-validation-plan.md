---
title: "feat: Add Playwright E2E test suite for pre-merge UI validation"
type: feat
status: active
date: 2026-03-06
---

# feat: Add Playwright E2E test suite for pre-merge UI validation

## Overview

Playwright is already installed (`@playwright/test ^1.58.2`) and a skeleton config exists (`playwright.config.ts`, `e2e/`), but all authenticated tests are stubbed out with `test.skip()` because there is no auth injection mechanism. CI has no e2e job, so the UI is never automatically validated before merge.

This plan completes the e2e setup end-to-end: auth injection, real smoke tests for every authenticated page, a seeded test database, and a CI job that gates merges on browser validation passing.

## Problem Statement

- `e2e/posts.spec.ts` is 100% skipped — the comment explicitly names the missing piece: *"requires auth bypass"*
- Two existing tests only cover the unauthenticated sign-in redirect; zero authenticated pages are tested
- A broken import, wrong API response shape in UI code, or broken form would ship undetected by the current test suite
- Industry standard: E2E tests run in CI as a required check before merge

## Proposed Solution

Three-phase implementation:

1. **Auth injection** — a `GET /api/test/session` endpoint (Node.js only, `NODE_ENV === "test"`) that mints a real NextAuth JWT using `next-auth/jwt`'s `encode()` and sets the session cookie. A Playwright `auth.setup.ts` fixture hits this endpoint once and saves `storageState` to disk so all test specs share the authenticated session without repeating the login flow.

2. **Core E2E test specs** — smoke/happy-path coverage for every authenticated route: dashboard, posts list (with tab switching), new post composer, and accounts page. Tests assert that pages load, key UI elements are present, and critical interactions work.

3. **CI integration** — a new `e2e` job in `.github/workflows/ci.yml` that depends on `test` (existing Jest job), spins up a PostgreSQL service container, runs `prisma db push` + a seed script, builds and starts the Next.js server, and runs Playwright against Chromium only.

## Technical Approach

### Auth Injection (the core problem)

NextAuth uses `strategy: "jwt"` — there is no `sessions` table to insert into. The session cookie (`next-auth.session-token`) must contain a valid signed JWT. The `next-auth/jwt` package exports `encode()` which signs with the same `NEXTAUTH_SECRET`, so:

```ts
// src/app/api/test/session/route.ts
import { encode } from "next-auth/jwt";

// Only available in test environment — hard-coded guard at top of file
if (process.env.NODE_ENV !== "test") {
  // Return 404 in all non-test environments
}
```

The endpoint:
1. Accepts `?email=test@example.com`
2. Validates email is in `ALLOWED_EMAILS`
3. Upserts a `User` row in the DB (test user must exist for `session.user.id` to resolve)
4. Calls `encode({ token: { sub: user.id, email }, secret })` from `next-auth/jwt`
5. Sets `next-auth.session-token` cookie in the response

**Playwright global setup fixture** (`e2e/fixtures/auth.setup.ts`):
```ts
import { test as setup } from "@playwright/test";

setup("authenticate", async ({ request, context }) => {
  const res = await request.get("/api/test/session?email=test@example.com");
  // Sets the session cookie on the context
  await context.storageState({ path: "e2e/.auth/user.json" });
});
```

`playwright.config.ts` adds a `setup` project that runs first and saves state:
```ts
projects: [
  { name: "setup", testMatch: /auth\.setup\.ts/ },
  {
    name: "chromium",
    use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
    dependencies: ["setup"],
  },
],
```

### Database Seed Script

A minimal `prisma/seed.ts` that creates:
- 1 test user (`test@example.com`)
- 2 social accounts (TWITTER, INSTAGRAM) owned by the test user
- 3 posts (1 DRAFT, 1 SCHEDULED, 1 PUBLISHED) owned by the test user

Run via `npx tsx prisma/seed.ts` in CI before `next build`.

### E2E Test Specs

**`e2e/auth.spec.ts`** (existing — expand):
- Unauthenticated redirect to sign-in ✓ (existing)
- Sign-in page renders ✓ (existing)

**`e2e/dashboard.spec.ts`** (new):
- Dashboard loads for authenticated user
- Stat cards are visible (Posts, Accounts, Scheduled)
- Sidebar navigation links are present

**`e2e/posts.spec.ts`** (replace stub):
- Posts list loads with seeded data
- Tab switching (All → Scheduled → Published → Failed) filters the list
- "New Post" button is present and navigates to composer

**`e2e/posts-new.spec.ts`** (new):
- Composer page loads
- Content textarea accepts input
- Platform account dropdown is populated (from seeded accounts)
- Submitting with valid data shows success / redirects

**`e2e/accounts.spec.ts`** (new):
- Accounts page loads
- Connected accounts (from seed) are displayed
- "Connect" buttons for unconnected platforms are visible

### CI Job

```yaml
# .github/workflows/ci.yml (addition)
e2e:
  name: E2E Tests
  needs: [test]           # Only run after unit tests pass
  runs-on: ubuntu-latest

  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_USER: test
        POSTGRES_PASSWORD: test
        POSTGRES_DB: ai_social_e2e
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
      ports:
        - 5432:5432

  env:
    DATABASE_URL: postgresql://test:test@localhost:5432/ai_social_e2e
    NEXTAUTH_URL: http://localhost:3000
    NEXTAUTH_SECRET: e2e-test-secret-32-chars-minimum!!
    # ... other required env vars with test values
    NODE_ENV: test

  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: "22", cache: "npm" }
    - run: npm ci
    - run: npx playwright install chromium --with-deps
    - run: npx prisma generate
    - run: npx prisma db push
    - run: npx tsx prisma/seed.ts
    - run: npm run build
    - run: npx playwright test
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: playwright-report/
```

Deploy jobs (`deploy-production`, `deploy-staging`) gain `e2e` as an additional `needs` dependency so failed E2E tests block deploys.

## System-Wide Impact

- **`/api/test/session` must be unreachable in production** — enforced by a hard `process.env.NODE_ENV !== "test"` guard returning 404 before any logic runs. The route must also not be bundled into the production build (can be placed in `src/app/api/test/` with a top-level guard so Next.js still includes it but it short-circuits immediately in non-test envs).
- **Seed data must be idempotent** — `upsert` in seed.ts so re-runs don't fail
- **`e2e/.auth/` must be gitignored** — session state files contain signed JWTs

## Acceptance Criteria

### Functional
- [x] `GET /api/test/session?email=...` returns 404 in production/development, sets valid session cookie in test
- [ ] Running `npm run test:e2e` locally (with `NODE_ENV=test npm run dev`) authenticates and runs all specs without skips
- [x] Dashboard, posts list, posts new, accounts pages each have at least one passing test
- [x] All 5 tab values (ALL, SCHEDULED, PUBLISHED, FAILED, DRAFT) are reachable via tab navigation test

### CI
- [x] `e2e` job appears in GitHub Actions on every PR
- [ ] `e2e` job blocks merge when any test fails (required check in branch protection)
- [x] Playwright HTML report is uploaded as artifact on failure so failures are diagnosable
- [x] Deploy jobs depend on `e2e` passing

### Safety
- [x] `/api/test/session` returns 404 when `NODE_ENV !== "test"` — verified by a unit test
- [x] `e2e/.auth/*.json` is in `.gitignore`

## Dependencies & Risks

| Dependency | Notes |
|---|---|
| `next-auth/jwt` `encode()` API | Stable in NextAuth v4; verify exact import path |
| PostgreSQL service in GHA | Standard pattern, well-documented |
| `npx tsx prisma/seed.ts` | Requires `tsx` — add to devDependencies if not present |
| Next.js `next build` in CI | ~2-3 min; consider caching `.next/` |
| `ALLOWED_EMAILS` must include test email | CI env var must include `test@example.com` |

**Risk: `next-auth.session-token` cookie name** — NextAuth uses `__Secure-` prefix in production (HTTPS). In local/CI with `http://localhost`, the cookie name is `next-auth.session-token` (no prefix). The test endpoint must set the correct name for the environment.

**Risk: Build env vars in CI** — `npm run build` calls `src/env.ts` which validates all required vars at startup. All vars (including dummy values for OAuth providers, `TOKEN_ENCRYPTION_KEY`, etc.) must be present in the e2e CI job env block.

## Implementation Checklist

### Phase 1 — Auth Injection
- [x] Create `src/app/api/test/session/route.ts` with NODE_ENV guard + JWT mint + cookie set
- [x] Add `test@example.com` to `ALLOWED_EMAILS` in CI env
- [x] Create `e2e/fixtures/auth.setup.ts` Playwright global setup
- [x] Update `playwright.config.ts` to add `setup` project + `storageState` on chromium project
- [x] Add `e2e/.auth/` to `.gitignore`
- [x] Add unit test asserting `/api/test/session` returns 404 outside test env

### Phase 2 — Test Specs
- [x] Create `prisma/seed.ts` with test user, 2 social accounts, 3 posts
- [x] Expand `e2e/auth.spec.ts`
- [x] Create `e2e/dashboard.spec.ts`
- [x] Replace `e2e/posts.spec.ts` stub with real tests
- [x] Create `e2e/posts-new.spec.ts`
- [x] Create `e2e/accounts.spec.ts`

### Phase 3 — CI
- [x] Add `e2e` job to `.github/workflows/ci.yml`
- [x] Add `e2e` to `needs` on deploy jobs
- [x] Add all required dummy env vars to CI job
- [ ] Verify `npm run test:e2e` passes locally end-to-end
- [ ] Set `e2e` as required status check in GitHub branch protection settings

## Sources & References

- Existing skeleton: `playwright.config.ts`, `e2e/auth.spec.ts`, `e2e/posts.spec.ts`
- NextAuth config: `src/lib/auth.ts` (JWT strategy, `NEXTAUTH_SECRET`)
- Middleware auth protection: `src/middleware.ts`
- Existing CI: `.github/workflows/ci.yml`
- `next-auth/jwt` encode/decode: https://next-auth.js.org/configuration/options#jwt
- Playwright storageState: https://playwright.dev/docs/auth#reuse-signed-in-state
- Playwright GitHub Actions: https://playwright.dev/docs/ci-intro
