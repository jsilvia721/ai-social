---
status: complete
priority: p3
issue_id: "028"
tags: [code-review, aws, s3, configuration]
dependencies: []
---

# S3 bucket name has a hardcoded fallback default in storage.ts

## Problem Statement

`src/lib/storage.ts` has:
```typescript
const BUCKET = process.env.AWS_S3_BUCKET ?? "ai-social";
const PUBLIC_URL = (process.env.AWS_S3_PUBLIC_URL ?? "").replace(/\/$/, "");
```

The fallback `"ai-social"` is a generic bucket name that almost certainly doesn't exist in any real AWS account. If `AWS_S3_BUCKET` is ever missing from the environment (misconfigured deploy, new environment), uploads will silently fail against a non-existent bucket instead of throwing a clear configuration error at startup.

## Findings

- **File:** `src/lib/storage.ts:8-9` — `?? "ai-social"` fallback
- `PUBLIC_URL` falls back to `""` — file URLs become `/uploads/abc.jpg` (relative path), which breaks in all environments
- Both env vars should be required; missing them should throw at startup (similar to `src/env.ts` pattern)
- Confirmed by: Code Simplicity Reviewer

## Proposed Solutions

### Option A: Assert env vars present at module load (Recommended)
```typescript
const BUCKET = process.env.AWS_S3_BUCKET;
const PUBLIC_URL = process.env.AWS_S3_PUBLIC_URL?.replace(/\/$/, "");
if (!BUCKET || !PUBLIC_URL) {
  throw new Error("AWS_S3_BUCKET and AWS_S3_PUBLIC_URL must be set");
}
```
- Pros: Fast failure with clear message; consistent with `src/env.ts` approach
- Cons: Slightly more verbose
- Effort: Tiny | Risk: None

### Option B: Add to `src/env.ts` Zod schema
- Add `AWS_S3_BUCKET: z.string()` and `AWS_S3_PUBLIC_URL: z.string().url()` as required fields in `src/env.ts`
- Remove fallbacks from `storage.ts`; use `env.AWS_S3_BUCKET` instead
- Pros: Consistent with existing env validation; caught at process startup everywhere
- Cons: `npm run build` now fails if vars missing (they already are required in prod via SST)
- Effort: Small | Risk: None

## Recommended Action

Option B — consistent with existing pattern in the codebase.

## Technical Details

- **Affected files:** `src/lib/storage.ts`, `src/env.ts`

## Acceptance Criteria

- [ ] Missing `AWS_S3_BUCKET` fails fast with a clear error message (not a silent wrong-bucket write)
- [ ] Missing `AWS_S3_PUBLIC_URL` fails fast (not silently building relative URLs)
- [ ] Test setup (`src/__tests__/setup.ts`) already sets both vars — no test changes needed

## Work Log

- 2026-03-06: Identified by Code Simplicity Reviewer during AWS migration PR review.

## Resources

- PR #2: feat/aws-sst-migration
