---
title: "SST Secret Not Set in Staging Causes SecretMissingError on Deploy"
date: "2026-03-10"
category: "deployment"
severity: "high"
component: "sst.config.ts / SST secrets"
symptoms:
  - "sst deploy --stage staging fails with SecretMissingError"
  - "New SST secret added as required but never set in staging or production"
  - "Deploy pipeline blocked until secret is manually set or made optional"
tags:
  - sst
  - secrets
  - staging
  - deploy
  - secretmissingerror
  - env
related_issues:
  - "PR #37"
  - "PR #35 (prior fix for BlotatoApiKey/SesFromEmail)"
---

# SST Secret Not Set Causes Deploy Failure

## Problem

PR #37 added `ReplicateApiToken` as a required SST secret but did not set the value in staging or production before deploying. The deploy failed immediately:

```
SecretMissingError: Set a value for ReplicateApiToken with `sst secret set ReplicateApiToken <value>`
```

## Root Cause

SST secrets declared with `new sst.Secret(...)` are **required by default** — if the value is not set in SSM Parameter Store for the target stage, the deploy fails before any Lambda code runs.

The codebase already had an established pattern for optional secrets (`BlotatoApiKey`, `SesFromEmail` from PR #35), but PR #37 did not follow it.

## Investigation Steps

1. `gh run view --log-failed` showed `SecretMissingError` for `ReplicateApiToken`
2. `sst.config.ts` had `replicateApiToken: new sst.Secret("ReplicateApiToken")` — required
3. `src/env.ts` had `REPLICATE_API_TOKEN: z.string().min(1)` in production — also required
4. `src/lib/media.ts` had no fallback for missing token in non-mock environments
5. Found PR #35 as the reference pattern for optional secrets

## Fix (3 files)

**`sst.config.ts`** — Make the secret optional (null):

```ts
// Before:
replicateApiToken: new sst.Secret("ReplicateApiToken"),
// ...
REPLICATE_API_TOKEN: secrets.replicateApiToken.value,

// After:
// Replicate: optional — set ReplicateApiToken secret to enable image generation
replicateApiToken: null,
// (no REPLICATE_API_TOKEN env var mapping — not set until secret is configured)
```

**`src/env.ts`** — Make the env var optional:

```ts
// Before:
REPLICATE_API_TOKEN: isMocked ? z.string().default("mock-key") : z.string().min(1),

// After:
REPLICATE_API_TOKEN: z.string().optional(),
```

**`src/lib/media.ts`** — Graceful degradation when token is absent:

```ts
// Before:
if (shouldMockExternalApis()) {

// After:
if (shouldMockExternalApis() || !env.REPLICATE_API_TOKEN) {
```

## Prevention: New Secret Checklist

**Copy this into every PR that adds a new `sst.Secret`:**

```
### New Secret Checklist
- [ ] Added `new sst.Secret("<Name>")` in `sst.config.ts`
- [ ] Mapped to env var in the `environment` object
- [ ] Added to `src/env.ts` with appropriate validation
- [ ] Ran: `npx sst secret set <Name> "<value>" --stage staging`
- [ ] Ran: `npx sst secret set <Name> "<value>" --stage production`
- [ ] Verified: `npx sst secret list --stage staging | grep <Name>`
- [ ] Verified: `npx sst secret list --stage production | grep <Name>`
- [ ] PR description lists all new secrets and confirms both stages are set
```

## Prevention Strategies

### 1. Default to optional for new features

When adding a secret for a feature that isn't critical to the core app, make it optional from the start. Follow the `BlotatoApiKey`/`SesFromEmail` pattern:
- `sst.config.ts`: set to `null` instead of `new sst.Secret(...)`
- `src/env.ts`: use `z.string().optional()`
- Runtime code: check for presence and degrade gracefully

### 2. CLAUDE.md hard rule

Add to Hard Rules: new SST secrets must document the `sst secret set` commands needed in the PR description for both staging and production.

### 3. CI warning annotation

A non-blocking CI step can grep for new `sst.Secret()` additions and post a warning:

```bash
NEW=$(git diff origin/main...HEAD -- sst.config.ts \
  | grep '^\+' \
  | grep -oP 'new sst\.Secret\("\K[^"]+')
if [ -n "$NEW" ]; then
  echo "::warning::New SST secrets detected: $NEW"
  echo "Ensure these are set in staging and production before deploy."
fi
```

## Cross-References

- [docs/solutions/deployment-failures/staging-deploy-failures.md](../deployment-failures/staging-deploy-failures.md) — Prior documentation of missing SST secrets pattern (Root Cause 1)
- PR #35 — Original fix that established the optional secret pattern
- CLAUDE.md — Infrastructure section on SST secrets
