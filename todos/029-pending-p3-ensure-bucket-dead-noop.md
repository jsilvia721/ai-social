---
status: complete
priority: p3
issue_id: "029"
tags: [code-review, cleanup, aws, s3]
dependencies: []
---

# `ensureBucket()` is a misleading no-op — should be removed

## Problem Statement

`src/lib/storage.ts` exports `ensureBucket(): Promise<void>` which has an empty body. It's a leftover from the MinIO/local S3 setup where the bucket needed to be created programmatically. On AWS with SST, the bucket is provisioned by the IaC (`sst.aws.Bucket`). The function does nothing but misleads callers into thinking it's performing a meaningful operation.

## Findings

- **File:** `src/lib/storage.ts:12` — `export async function ensureBucket(): Promise<void> {}`
- Callers who see this function believe it's necessary to call before using storage
- Code that calls `ensureBucket()` is dead weight (async function call + await that does nothing)
- Confirmed by: Code Simplicity Reviewer

## Proposed Solutions

### Option A: Delete the function (Recommended)
- Remove `ensureBucket()` from `storage.ts`
- Find and remove all call sites (grepping for `ensureBucket`)
- Pros: Honest API; less exported surface
- Effort: Tiny | Risk: None

### Option B: Replace with a comment
- Keep the function signature but add a JSDoc comment: `/** No-op: bucket is provisioned by SST at deploy time. */`
- Pros: Preserves call sites without breaking anything
- Cons: Still exports a misleading function
- Effort: Tiny | Risk: None

## Recommended Action

Option A — delete it and remove call sites. It's already been exported as a no-op (see comment in current code: `// No-op: bucket is provisioned by SST at deploy time.`). If it's documented as a no-op and does nothing, it shouldn't exist.

## Technical Details

- **Affected files:** `src/lib/storage.ts`
- Search for call sites: `grep -r "ensureBucket" src/`

## Acceptance Criteria

- [ ] `ensureBucket` removed from `storage.ts`
- [ ] All call sites removed
- [ ] No TypeScript errors

## Work Log

- 2026-03-06: Identified by Code Simplicity Reviewer during AWS migration PR review.

## Resources

- PR #2: feat/aws-sst-migration
