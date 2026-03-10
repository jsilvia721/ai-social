---
status: complete
priority: p2
issue_id: "019"
tags: [code-review, security, aws, logging]
dependencies: []
---

# SST secrets injected as env vars are visible in CloudWatch Lambda config

## Problem Statement

SST injects secrets as plain environment variables on the Lambda function. While the values are sourced from SSM Parameter Store (encrypted at rest), once they're injected as Lambda env vars they appear in plaintext in the Lambda function configuration in the AWS console and in any process dumps. Additionally, any `console.log(process.env)` or error that serializes the environment would expose all secrets in CloudWatch logs.

## Findings

- **File:** `sst.config.ts:41-59` — all 14 secrets mapped into `environment` object as plaintext values
- Lambda env vars are visible to anyone with `lambda:GetFunctionConfiguration` IAM permission
- If any code path logs `process.env` on error (common debugging pattern), all secrets are exposed
- CloudWatch log retention is not configured (logs never expire by default)
- Confirmed by: Security Sentinel

## Proposed Solutions

### Option A: Audit code for env var logging + set log retention (Recommended)
- Search codebase for `console.log(process.env` or similar patterns and remove
- Set CloudWatch log retention in sst.config.ts (30-90 days)
- Restrict `lambda:GetFunctionConfiguration` in IAM to ops roles only
- Pros: Immediate, no architectural change
- Effort: Small | Risk: Low

### Option B: Use SSM `GetParameter` at runtime instead of env vars
- Remove secrets from Lambda env; fetch from SSM at startup using `aws-sdk`
- Cache in module scope (not process.env)
- Pros: Secrets never in env; SSM access auditable via CloudTrail
- Cons: SSM API call adds ~50ms cold start latency; more complex
- Effort: Large | Risk: Medium

### Option C: Use AWS Secrets Manager with rotation
- Store secrets in Secrets Manager; fetch at startup
- Pros: Native rotation support; fine-grained access control
- Cons: Secrets Manager costs $0.40/secret/mo (~$5.60/mo for 14 secrets); overkill for POC
- Effort: Large | Risk: Low

## Recommended Action

Option A — pragmatic for POC scale. Add log retention + audit for env logging.

## Technical Details

- **Affected files:** `sst.config.ts`, all Lambda handlers
- Log groups: `/aws/lambda/ai-social-*`

## Acceptance Criteria

- [ ] No `console.log(process.env)` or equivalent in codebase
- [ ] CloudWatch log retention set to ≤ 90 days in sst.config.ts or via AWS console
- [ ] IAM deploy role scoped to not include `lambda:GetFunctionConfiguration` for non-ops

## Work Log

- 2026-03-06: Identified by Security Sentinel during AWS migration PR review.

## Resources

- PR #2: feat/aws-sst-migration
