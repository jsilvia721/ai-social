---
status: complete
priority: p1
issue_id: "016"
tags: [code-review, security, aws, s3]
dependencies: []
---

# S3 CORS wildcard allows writes from any origin

## Problem Statement

`sst.config.ts` configures the S3 bucket with `allowedOrigins: ["*"]` for `PUT` and `POST` methods. This allows any website on the internet to make authenticated upload requests to the bucket if they can obtain a valid presigned URL. Combined with a CSRF vulnerability or XSS on any site that holds a presigned URL, an attacker could upload arbitrary content to your S3 bucket from a third-party origin.

## Findings

- **File:** `sst.config.ts:36` — `cors: [{ allowedMethods: ["GET", "PUT", "POST"], allowedOrigins: ["*"] }]`
- `PUT` and `POST` are write operations — these should be restricted to your own domain(s)
- `GET` with wildcard is fine for serving public assets; write operations are not
- Confirmed by: Security Sentinel

## Proposed Solutions

### Option A: Restrict writes to own domains (Recommended)
- Split GET vs PUT/POST into separate CORS rules
- Allow `*` for GET only; restrict PUT/POST to `https://d11oxnidmahp76.cloudfront.net` (and any custom domain)
- Example:
  ```typescript
  cors: [
    { allowedMethods: ["GET"], allowedOrigins: ["*"] },
    { allowedMethods: ["PUT", "POST"], allowedOrigins: [
      "https://d11oxnidmahp76.cloudfront.net",
      // add staging URL
    ]},
  ]
  ```
- Pros: Simple change, precise control
- Cons: Must update when domain changes
- Effort: Small | Risk: Low

### Option B: Use server-side uploads only
- Remove presigned URLs entirely; all uploads proxy through the Next.js Lambda
- Pros: CORS irrelevant; full server control
- Cons: Lambda payload size limit (6 MB); increases Lambda invocations and latency
- Effort: Large | Risk: Medium

### Option C: Keep wildcard, add presigned URL expiry + size limit
- Keep `*` CORS but ensure presigned URLs expire quickly (already 1 hour — tighten to 5-15 min) and enforce `ContentLengthRange` condition
- Pros: Minimal code change
- Cons: Does not truly prevent cross-origin writes; only limits the window
- Effort: Small | Risk: Medium (incomplete fix)

## Recommended Action

Option A. Two-rule CORS configuration is the minimal correct fix.

## Technical Details

- **Affected files:** `sst.config.ts`
- CloudFront URL: `https://d11oxnidmahp76.cloudfront.net`
- Staging URL will be different (separate SST stage creates separate CloudFront)

## Acceptance Criteria

- [ ] PUT and POST CORS restricted to known app origins only
- [ ] GET still allows `*` (needed for public asset serving)
- [ ] Verified by deploying and confirming presigned upload still works from app
- [ ] Staging and production domains both listed

## Work Log

- 2026-03-06: Identified by Security Sentinel during AWS migration PR review.

## Resources

- PR #2: feat/aws-sst-migration
- AWS S3 CORS docs: https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html
