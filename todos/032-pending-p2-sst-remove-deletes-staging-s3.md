---
status: complete
priority: p2
issue_id: "032"
tags: [code-review, architecture, aws, s3, data-safety]
dependencies: []
---

# `removal: "remove"` destroys staging S3 bucket contents on `sst remove`

## Problem Statement

`sst.config.ts` sets `removal: input?.stage === "production" ? "retain" : "remove"`. This means `npx sst remove --stage staging` will:
1. Empty the staging S3 bucket (SST does this automatically to unblock CloudFormation deletion)
2. Delete the bucket

The `Post.mediaUrls` database column stores full S3 URLs. After staging bucket deletion, all media references in the staging database become broken 404s. This is not automatically recoverable — the uploaded files are gone.

## Findings

- **File:** `sst.config.ts:8` — `removal: input?.stage === "production" ? "retain" : "remove"`
- SST's `removal: "remove"` causes CloudFormation to delete resources including S3 bucket contents
- The S3 bucket stores user-uploaded images and videos referenced by database rows
- Confirmed by: Architecture Strategist

## Proposed Solutions

### Option A: Set bucket-level `forceDestroy: false` (Recommended)
Override the bucket's deletion behavior regardless of top-level removal policy:
```typescript
const bucket = new sst.aws.Bucket("Storage", {
  public: true,
  cors: [...],
  transform: {
    bucket: { forceDestroy: false },
  },
});
```
With `forceDestroy: false`, CloudFormation will refuse to delete a non-empty bucket — `sst remove` will fail with a clear error rather than silently destroying media files.

- Pros: Protects media in all environments; `sst remove` still cleans up everything else
- Cons: Must manually empty the bucket to fully tear down
- Effort: Tiny | Risk: None

### Option B: Change staging to `retain` as well
- `removal: "retain"` for all stages
- Pros: Nothing is ever auto-deleted
- Cons: Resources accumulate and must be manually cleaned up
- Effort: Tiny | Risk: None (slightly messier AWS console)

### Option C: Accept the behavior, document it
- Add a comment: `// WARNING: sst remove --stage staging will delete all uploaded media files`
- Pros: No change
- Cons: Next developer running `sst remove` during a cleanup has no guard
- Effort: None | Risk: Medium

## Recommended Action

Option A — one-line SST transform.

## Technical Details

- **Affected files:** `sst.config.ts`

## Acceptance Criteria

- [ ] `sst remove --stage staging` does not destroy S3 bucket contents
- [ ] If bucket is non-empty, `sst remove` fails with a clear error (not silently deletes)
- [ ] Production bucket remains on `retain` (already correct)

## Work Log

- 2026-03-06: Identified by Architecture Strategist during AWS migration PR review.

## Resources

- PR #2: feat/aws-sst-migration
