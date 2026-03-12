---
title: Blotato OAuth Token Refresh and AES-256-GCM Encryption Pattern
date: 2026-03-12
category: infrastructure-patterns
severity: informational
module: src/lib/token.ts, src/lib/crypto.ts
symptom: "OAuth tokens expire and must be refreshed before platform API calls; tokens at rest must be encrypted"
root_cause: "Platform OAuth tokens have short lifetimes (2h Twitter, 1h YouTube) requiring proactive refresh with concurrent-safe storage"
component:
  - src/lib/token.ts
  - src/lib/crypto.ts
  - src/lib/platforms
  - src/app/api/connect
tags:
  - oauth
  - token-refresh
  - encryption
  - aes-256-gcm
  - blotato
  - twitter
  - youtube
  - tiktok
  - security
status: implemented
---

# Blotato OAuth Token Refresh & Encryption Pattern

## Problem & Context

Social platform OAuth tokens expire frequently (Twitter: 2 hours, YouTube: 1 hour, TikTok: variable). The application must proactively refresh tokens before they expire, store them encrypted at rest, and handle concurrent refresh attempts safely (e.g., publish cron and metrics cron hitting the same account simultaneously).

## Solution

### 1. AES-256-GCM Encryption (`src/lib/crypto.ts`)

All tokens are encrypted before database storage using AES-256-GCM with random IVs.

**Key configuration:**
- `TOKEN_ENCRYPTION_KEY` env var: 64 hex characters (32 bytes)
- Algorithm: `aes-256-gcm` — authenticated encryption (prevents tampering)
- Output format: `base64url(iv):base64url(ciphertext):base64url(authTag)`

**Legacy graceful fallback:** If a stored token has no colons (plaintext from before encryption was added), `decryptToken()` returns it as-is. This allows gradual migration without downtime.

### 2. Token Refresh (`src/lib/token.ts` — `ensureValidToken()`)

Called before every platform API call. Uses a 5-minute buffer to refresh proactively.

```
1. Decrypt stored accessToken and refreshToken
2. If no expiry OR expires > 5 min from now → return accessToken
3. If Instagram/Facebook → return accessToken (Page Access Tokens never expire)
4. If no refreshToken → throw error
5. Call platform-specific refresh endpoint
6. Optimistic CAS write:
   UPDATE WHERE id = X AND updatedAt = account.updatedAt
   SET accessToken = encrypt(new), refreshToken = encrypt(new), expiresAt
7. If count = 0 → another process already refreshed → re-read from DB
8. Return fresh decrypted token
```

The **Compare-And-Swap (CAS)** pattern using `updatedAt` prevents double-refresh when multiple Lambda instances hit the same account concurrently.

### 3. Platform-Specific Refresh Behavior

| Platform | Access Token Lifetime | Refresh Token Rotates? | Notes |
|---|---|---|---|
| Twitter | 2 hours | Yes (both rotate) | PKCE OAuth 2.0, Basic auth header |
| YouTube | 1 hour | No (refresh token stable) | Google OAuth, refresh token reused |
| TikTok | Variable | Yes (both rotate) | Client key/secret in body |
| Instagram | Never expires | N/A | Page Access Token from long-lived User token |
| Facebook | Never expires | N/A | Page Access Token from long-lived User token |

### 4. OAuth Connect Flows

**Twitter (PKCE):**
1. Generate `codeVerifier` + `codeChallenge` (SHA256)
2. Store state + verifier in httpOnly secure cookie (5 min TTL)
3. Redirect to Twitter OAuth → callback exchanges code for tokens
4. Encrypt both tokens, store with `expiresAt`

**Meta (Facebook + Instagram):**
1. Exchange code → short-lived User Access Token (24h)
2. Exchange → long-lived User Access Token (60 days)
3. Fetch all Pages → extract Page Access Tokens (permanent)
4. For each Page with linked Instagram → upsert both accounts
5. Page Access Tokens don't expire, so no refresh needed

### 5. Database Schema

```prisma
model SocialAccount {
  accessToken   String?   @db.Text  // AES-256-GCM encrypted
  refreshToken  String?   @db.Text  // AES-256-GCM encrypted
  expiresAt     DateTime?           // null = never expires
  updatedAt     DateTime  @updatedAt // CAS field for concurrent refresh
}
```

## Security Properties

1. **Encryption at rest** — AES-256-GCM with random IV per encryption (different ciphertext each time)
2. **Authentication tag** — prevents tampering with stored tokens
3. **CSRF protection** — state cookie with 5-min TTL, deleted immediately after use
4. **PKCE** — Twitter uses code challenge to prevent authorization code interception
5. **Concurrent safety** — CAS prevents double-refresh race conditions
6. **Graceful degradation** — legacy plaintext tokens still work during migration

## Common Mistakes to Avoid

1. **Don't skip `ensureValidToken()` before API calls** — tokens may be expired
2. **Don't store tokens in plaintext** — always use `encryptToken()` before database writes
3. **Don't assume refresh tokens are stable** — Twitter and TikTok rotate both tokens on refresh
4. **Don't refresh Instagram/Facebook tokens** — Page Access Tokens are permanent
5. **Don't ignore CAS count=0** — it means another process already refreshed; re-read from DB

## Cross-References

- [CLAUDE.md - Platform integrations](/CLAUDE.md) — Blotato overview, SSRF guards
- [docs/solutions/infrastructure-patterns/ssrf-guard-media-url-validation.md](./ssrf-guard-media-url-validation.md) — SSRF protection for media URLs
- `.claude/rules/deployment.md` — SST secret setup for `TokenEncryptionKey`
