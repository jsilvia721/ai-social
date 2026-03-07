---
status: complete
priority: p1
issue_id: "004"
tags: [code-review, security, ssrf]
dependencies: []
---

# SSRF: Server fetches user-supplied mediaUrls without validation

## Problem Statement

`publishYouTubeVideo` (and potentially other platform publishers) performs a `fetch(mediaUrls[0])` where `mediaUrls` comes from the `Post.mediaUrls` database field — originally from user input. If an attacker (or compromised session) can write an internal URL to `mediaUrls` (e.g., `http://169.254.169.254/latest/meta-data/` on AWS, or Railway internal service URLs), the server will make that request and the response is processed. This is a Server-Side Request Forgery (SSRF) vulnerability.

## Findings

- **File:** `src/lib/platforms/youtube/index.ts:47` — `fetch(mediaUrls[0])` with no URL validation
- Railway and AWS environments expose internal metadata endpoints via link-local addresses
- The S3 presigned URL flow is designed so `mediaUrls` should only ever contain S3 presigned URLs — but this is not enforced
- Confirmed by: Security Sentinel

## Proposed Solutions

### Option A: Allowlist URL prefix validation (Recommended)
- Before any server-side `fetch` of a media URL, validate that the URL starts with your S3 bucket's expected prefix
- Reject with an error if URL does not match
- Pros: Simple, zero dependencies, catches the attack at source
- Cons: Must keep S3 bucket URL in env config
- Effort: Small | Risk: Low

### Option B: Store only S3 object keys, not full URLs
- Store the S3 key (e.g., `uploads/abc123.mp4`) in `mediaUrls` instead of the full presigned URL
- Reconstruct the presigned URL server-side at publish time using the known bucket/region
- Pros: Eliminates SSRF entirely (user never supplies the URL), cleaner data model
- Cons: Requires schema + upload flow changes; presigned URLs have expiry
- Effort: Medium | Risk: Low

### Option C: Use AWS SDK to fetch object directly
- Replace `fetch(mediaUrls[0])` with `s3.getObject({ Bucket, Key })` using the parsed key
- Pros: No HTTP fetch of user-supplied URL at all; SSRF impossible
- Cons: Requires parsing key from URL or storing key separately (similar to Option B)
- Effort: Medium | Risk: Low

## Recommended Action

Short term: Option A (URL prefix allowlist) — can be done in one line per platform. Long term: Option B or C.

## Technical Details

- **Affected files:** `src/lib/platforms/youtube/index.ts`, potentially `instagram/index.ts`, `tiktok/index.ts`
- S3 bucket URL prefix should come from `env.AWS_BUCKET_URL` or similar

## Acceptance Criteria

- [ ] Server-side `fetch` of media URLs validates against S3 bucket prefix allowlist
- [ ] Non-S3 URLs are rejected before fetch (not just before upload)
- [ ] `http://169.254.169.254/...` returns 400 from the publish flow
- [ ] Test coverage for SSRF guard

## Work Log

- 2026-03-06: Identified by Security Sentinel. Flagged P1.

## Resources

- PR #1: feat/milestone-1-platform-connect
- OWASP SSRF: https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
