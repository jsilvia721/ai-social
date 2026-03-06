---
status: pending
priority: p1
issue_id: "007"
tags: [code-review, security, tokens, database]
dependencies: []
---

# OAuth tokens stored in plaintext in the database

## Problem Statement

`accessToken` and `refreshToken` are stored unencrypted in the `SocialAccount` table. Anyone with read access to the Postgres database (Railway dashboard, a DB credential leak, a SQL injection) has full access to all users' social media accounts — can post, delete, read DMs, etc. This violates the principle of least privilege and is a significant breach amplifier.

## Findings

- **File:** `prisma/schema.prisma` — `SocialAccount.accessToken String`, `refreshToken String?`
- Railway Postgres credentials are visible to anyone with project access
- A single DB credential leak exposes all social account tokens for all users
- Confirmed by: Security Sentinel

## Proposed Solutions

### Option A: Application-level encryption at rest (Recommended for now)
- Encrypt token fields with AES-256-GCM using a key from an env var (`TOKEN_ENCRYPTION_KEY`) before writing to DB
- Decrypt on read in `src/lib/token.ts`
- Store as `String` (base64 ciphertext) — no schema change required
- Pros: Separates DB compromise from token compromise; low complexity; no new infra
- Cons: Encryption key still in env; if env is leaked too, tokens are exposed
- Effort: Medium | Risk: Low

### Option B: External secrets store (HashiCorp Vault / AWS Secrets Manager)
- Store tokens in Vault/SSM, keep only a reference ID in Postgres
- Pros: Purpose-built for secrets; fine-grained access control; audit logs
- Cons: New infra dependency; significant complexity for a POC
- Effort: Large | Risk: Medium (operational complexity)

### Option C: Accept risk for POC (defer)
- Document the risk explicitly; implement Option A before adding more users
- Pros: No work now
- Cons: All tokens at risk if DB is breached
- Effort: None | Risk: High

## Recommended Action

Option A. Implement `encryptToken(plaintext)` / `decryptToken(ciphertext)` helpers using Node.js `crypto.createCipheriv` (AES-256-GCM). Apply in all places tokens are written/read.

## Technical Details

- **Affected files:** `src/lib/token.ts`, all OAuth callback routes that write tokens
- New env var needed: `TOKEN_ENCRYPTION_KEY` (32-byte hex, generated via `openssl rand -hex 32`)
- Add to `src/env.ts` and `src/__tests__/setup.ts`

## Acceptance Criteria

- [ ] Token fields in DB are never stored as plaintext
- [ ] Encrypt on write in all callback routes; decrypt on read in `ensureValidToken`
- [ ] `TOKEN_ENCRYPTION_KEY` added to env schema and Railway secrets
- [ ] Tests updated to use encrypted values in mock DB

## Work Log

- 2026-03-06: Identified by Security Sentinel. Flagged P1.

## Resources

- PR #1: feat/milestone-1-platform-connect
- Node.js crypto AES-GCM: https://nodejs.org/api/crypto.html#cryptocreatecipherivalgorithm-key-iv-options
