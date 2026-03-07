---
status: complete
priority: p2
issue_id: "033"
tags: [code-review, security, meta, logging, oauth]
dependencies: []
---

# Meta callback logs plaintext Facebook Page Access Tokens to CloudWatch

## Problem Statement

`src/app/api/connect/meta/callback/route.ts` contains a `console.log` that dumps the full `/me/accounts` Graph API response to stdout. This response includes `access_token` for each managed Facebook Page. In Lambda, stdout goes directly to CloudWatch Logs in plaintext. Page Access Tokens derived from long-lived user tokens never expire and allow full control of the Facebook Page (posting, reading messages, etc.).

This is an active credential leak in production today.

## Findings

- **File:** `src/app/api/connect/meta/callback/route.ts:99`
  ```typescript
  console.log("[meta/callback] pages response:", JSON.stringify(pagesJson));
  ```
- The `pagesJson` object contains `{ data: [{ id, name, access_token, ... }] }`
- CloudWatch log group: `/aws/lambda/ai-social-production-Web-*`
- Page Access Tokens: long-lived, never expire when derived from long-lived user token
- Anyone with `logs:GetLogEvents` IAM permission on the log group can read these tokens
- Confirmed by: Security Sentinel (Finding 8)

## Proposed Solutions

### Option A: Remove the log line entirely (Recommended — immediate)
```typescript
// Remove this line:
console.log("[meta/callback] pages response:", JSON.stringify(pagesJson));
```
Replace with a non-sensitive log if needed:
```typescript
console.log("[meta/callback] pages found:", pagesJson.data?.length ?? 0);
```
- Pros: Immediate fix; one line change
- Effort: Tiny | Risk: None

### Option B: Log only non-sensitive fields
```typescript
console.log("[meta/callback] pages:", pagesJson.data?.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
```
- Pros: Retains useful debug info (page IDs and names)
- Cons: Slightly more code than just removing the line
- Effort: Tiny | Risk: None

## Recommended Action

Option A or B — both are one-line changes. Do this before the next production deploy.

## Technical Details

- **Affected files:** `src/app/api/connect/meta/callback/route.ts`
- Also audit all other OAuth callback routes for similar token logging:
  - `src/app/api/connect/twitter/route.ts`
  - `src/app/api/connect/tiktok/callback/route.ts`

## Acceptance Criteria

- [ ] `console.log` of full `pagesJson` (or any response containing `access_token`) removed from meta callback
- [ ] All other OAuth callback routes audited for token logging
- [ ] No plaintext access tokens in CloudWatch Logs after a test OAuth connect flow

## Work Log

- 2026-03-06: Identified by Security Sentinel during AWS migration PR review. Active credential leak — fix immediately.

## Resources

- PR #2: feat/aws-sst-migration
