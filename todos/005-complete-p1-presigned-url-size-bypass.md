---
status: pending
priority: p1
issue_id: "005"
tags: [code-review, security, uploads]
dependencies: []
---

# Presigned URL: fileSize parameter is optional, size limit trivially bypassed

## Problem Statement

The presigned URL endpoint checks `if (fileSize && parseInt(fileSize, 10) > MAX_VIDEO_SIZE)` — if the client omits `fileSize`, the guard is skipped entirely and an unrestricted presigned PUT URL is issued. S3's `PutObjectCommand` does not embed a `Content-Length` condition in the presigned URL, so a client can upload a file of any size (bypassing the 500 MB limit).

## Findings

- **File:** `src/app/api/upload/presigned/route.ts:38-39`
- `fileSize` query param is not required; `if (fileSize && ...)` silently skips validation when absent
- No `content-length-range` S3 policy condition on the presigned URL
- Confirmed by: Security Sentinel, TypeScript Reviewer

## Proposed Solutions

### Option A: Make fileSize required + add S3 content-length-range condition (Recommended)
- Return 400 if `fileSize` is absent
- Add `Conditions: [["content-length-range", 1, MAX_VIDEO_SIZE]]` to the presigned URL policy
- Pros: Enforced server-side AND at S3 level; impossible to bypass
- Cons: Requires `createPresignedPost` instead of `getSignedUrl` for `PutObjectCommand`
- Effort: Small | Risk: Low

### Option B: Make fileSize required only (simpler)
- Return 400 if `fileSize` is absent or > MAX_VIDEO_SIZE
- Does not add S3-level enforcement
- Pros: Quick fix
- Cons: Client could still bypass by uploading more bytes than declared; no S3 enforcement
- Effort: Very Small | Risk: Medium

### Option C: Add Zod validation on all params
- Use `z.coerce.number().int().positive().max(MAX_VIDEO_SIZE)` for fileSize
- Use `z.enum([...])` for mimeType
- Pros: Comprehensive, handles normalization (trim, lowercase), clear error messages
- Cons: Slight overhead
- Effort: Small | Risk: Low

## Recommended Action

Option A (make required + S3 policy). Use `@aws-sdk/s3-presigned-post` (`createPresignedPost`) which natively supports `content-length-range` conditions. Combine with Option C Zod validation.

## Technical Details

- **Affected files:** `src/app/api/upload/presigned/route.ts`, `src/lib/storage.ts`
- AWS SDK `createPresignedPost` doc: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-presigned-post/

## Acceptance Criteria

- [ ] Request without `fileSize` returns 400
- [ ] Request with `fileSize` > 500MB returns 400
- [ ] Presigned URL has embedded `content-length-range` S3 policy condition
- [ ] Uploading > 500MB via presigned URL is rejected by S3 (not just the API)

## Work Log

- 2026-03-06: Identified by Security Sentinel, TypeScript Reviewer. Flagged P1.

## Resources

- PR #1: feat/milestone-1-platform-connect
