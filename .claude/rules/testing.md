---
paths:
  - "src/__tests__/**"
  - "jest.config.*"
---

# Testing Conventions

## Setup
`src/__tests__/setup.ts` runs via `setupFiles` (before module import) to populate env vars so `src/env.ts` Zod parse doesn't throw. `AWS_S3_PUBLIC_URL` is set to `https://storage.example.com` — test media URLs must use this prefix to pass the SSRF guard.

## Coverage Thresholds (enforced in CI)
75% statements/lines/branches, 70% functions.

### Excluded from coverage
`src/components/**`, `src/cron/**`, `src/lib/auth.ts`, `src/lib/db.ts`, `src/lib/storage.ts`, `src/lib/utils.ts`, pages, layouts, shadcn/ui, providers, types.

## Mocking

**Prisma mock pattern** — copy this exactly:
```ts
import { prismaMock } from "@/__tests__/mocks/prisma";
jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
beforeEach(() => mockReset(prismaMock));
```

- HTTP: spy on `global.fetch` — do NOT use `msw` or other interceptors
- All tests run in `node` environment (not jsdom)
- `src/cron/*.ts` Lambda handlers are intentionally not unit-tested (thin wrappers)
