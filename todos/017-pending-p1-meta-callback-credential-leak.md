---
status: complete
priority: p1
issue_id: "017"
tags: [code-review, security, oauth, meta]
dependencies: []
---

# Meta OAuth callback may leak credentials in CloudWatch logs

## Problem Statement

The Meta (Instagram/Facebook) OAuth callback route processes the `code` parameter and exchanges it for access tokens. If any error occurs during token exchange and the error is logged with the full request context (URL, params, or token response body), the access token or auth code could appear in CloudWatch logs in plaintext. Lambda functions running in production have CloudWatch logging enabled by SST by default with no log redaction.

## Findings

- **File:** `src/app/api/connect/meta/callback/route.ts` — OAuth callback exchanges `code` for tokens
- CloudWatch logs capture all console.error/console.log output from Lambda functions
- If token exchange fails and the error includes the response body, the token is logged
- SST does not configure log redaction or log group encryption by default
- CloudWatch log retention is indefinite by default (logs never expire)
- Confirmed by: Security Sentinel

## Proposed Solutions

### Option A: Audit and sanitize error logging (Recommended — immediate)
- Review all `console.error` and `console.log` calls in OAuth callback routes
- Never log raw error responses from OAuth token endpoints (they contain `access_token`)
- Log only the error type/message, not the full response body
- Example: `console.error("Meta token exchange failed", error.message)` not `console.error(error)`
- Pros: Immediate, no infrastructure changes required
- Effort: Small | Risk: Low

### Option B: Set CloudWatch log retention + encryption
- Add KMS key + CloudWatch log group encryption in `sst.config.ts`
- Set log retention to 30 days
- Pros: Defense-in-depth; logs expire and are encrypted at rest
- Cons: KMS costs ~$1/mo; doesn't prevent logging in the first place
- Effort: Small | Risk: Low

### Option C: Use structured logging with field redaction
- Adopt a structured logger (e.g., `pino`) that supports field redaction
- Redact `access_token`, `refresh_token`, `code` fields automatically
- Pros: Systematic protection across all routes
- Cons: New dependency; medium refactor
- Effort: Medium | Risk: Low

## Recommended Action

Option A immediately (audit + sanitize error logging in all OAuth callbacks). Option B as follow-up defense-in-depth.

## Technical Details

- **Affected files:** `src/app/api/connect/meta/callback/route.ts`, `src/app/api/connect/twitter/route.ts`, `src/app/api/connect/tiktok/callback/route.ts`
- Lambda CloudWatch log group: `/aws/lambda/ai-social-production-Web-*`
- SST does not configure log retention or encryption in current `sst.config.ts`

## Acceptance Criteria

- [ ] All OAuth callback routes reviewed for token/secret logging
- [ ] No `access_token`, `refresh_token`, or OAuth `code` values appear in logs on error paths
- [ ] CloudWatch log group retention set to ≤ 90 days
- [ ] Test: trigger a deliberate OAuth failure and confirm no tokens in log output

## Work Log

- 2026-03-06: Identified by Security Sentinel during AWS migration PR review.

## Resources

- PR #2: feat/aws-sst-migration
