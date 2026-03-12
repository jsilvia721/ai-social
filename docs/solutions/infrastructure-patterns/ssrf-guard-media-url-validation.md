---
title: SSRF Guard Pattern for Media URL Validation
date: 2026-03-12
category: infrastructure-patterns
severity: informational
module: src/lib/blotato/ssrf-guard.ts
symptom: "Server-side media fetches must be restricted to trusted origins to prevent SSRF attacks"
root_cause: "User-supplied media URLs could point to internal services if not validated before server-side fetch"
component:
  - src/lib/blotato/ssrf-guard.ts
  - src/lib/blotato/publish.ts
  - src/app/api/posts/route.ts
  - src/app/api/posts/[id]/route.ts
  - src/app/api/briefs/[id]/fulfill/route.ts
tags:
  - ssrf
  - security
  - media-urls
  - s3
  - validation
  - owasp
status: implemented
---

# SSRF Guard Pattern for Media URL Validation

## Problem & Context

When the server fetches media URLs on behalf of users (e.g., publishing a post with images to a social platform), an attacker could supply URLs pointing to internal services (`http://169.254.169.254/` for AWS metadata, `http://localhost:5432/` for databases, etc.). This is a Server-Side Request Forgery (SSRF) vulnerability — OWASP Top 10 (A10:2021).

The guard ensures all media URLs originate from the application's own S3 bucket before any server-side fetch.

## Solution

### The Guard (`src/lib/blotato/ssrf-guard.ts`)

```typescript
export function assertSafeMediaUrl(url: string): void {
  const base = env.AWS_S3_PUBLIC_URL;
  if (!base) {
    throw new Error("SSRF guard: AWS_S3_PUBLIC_URL is not configured");
  }
  const allowedPrefix = base.endsWith("/") ? base : `${base}/`;
  if (!url.startsWith(allowedPrefix)) {
    throw new Error(
      `SSRF guard: mediaUrl must start with ${allowedPrefix}. Got: ${url}`,
    );
  }
}
```

**Key security detail:** The trailing-slash normalization prevents subdomain-bypass attacks. Without it, `https://storage.example.com.evil.com/payload` would pass a naive `startsWith("https://storage.example.com")` check.

### Where It's Called

The guard validates media URLs at every entry point where user-supplied URLs could reach a server-side fetch:

| Location | When |
|---|---|
| `POST /api/posts` | Creating a post with media |
| `PATCH /api/posts/[id]` | Updating post media |
| `POST /api/briefs/[id]/fulfill` | AI fulfillment attaching media |
| `src/lib/blotato/publish.ts` | Before sending media to Blotato API for publishing |

### Why Upload APIs Don't Need the Guard

`POST /api/upload` and `GET /api/upload/presigned` generate URLs server-side via `getPublicUrl()` in `src/lib/storage.ts`. These URLs are guaranteed safe because the server constructs them from `AWS_S3_PUBLIC_URL` + the object key. The guard is only needed where user-supplied URLs are accepted.

### Configuration

```typescript
// src/env.ts
AWS_S3_PUBLIC_URL: z.string().url().optional()

// src/lib/storage.ts (local dev fallback)
const publicBase = env.AWS_S3_PUBLIC_URL ?? "http://localhost:9000/ai-social-dev";
```

## The Security Perimeter

```
Browser uploads → Presigned URL → S3 directly (no server fetch)
Server generates URL → getPublicUrl() → guaranteed safe by construction
User provides URL → assertSafeMediaUrl() → validated before any fetch
Publishing → assertSafeMediaUrl() → validated before Blotato API call
Database storage → only validated URLs persisted in posts.mediaUrls
```

## Common Mistakes to Avoid

1. **Don't skip the guard for "internal" callers** — the AI fulfillment endpoint also validates, because the AI could hallucinate URLs
2. **Don't use `startsWith()` without trailing-slash normalization** — enables subdomain bypass
3. **Don't validate only at the API layer** — also validate at the publish layer (defense in depth)
4. **Don't allow `AWS_S3_PUBLIC_URL` to be unset in production** — the guard throws if unconfigured

## Test Coverage

```typescript
// src/__tests__/api/briefs-fulfill.test.ts
it("returns 400 for unsafe media URLs", async () => {
  const [req, ctx] = makeRequest("cb-1", {
    ...validBody,
    mediaUrls: ["https://evil.com/image.jpg"],
  });
  const res = await POST(req, ctx);
  expect(res.status).toBe(400);
  expect(body.error).toContain("Invalid media URL");
});
```

## Cross-References

- [CLAUDE.md - Platform integrations](/CLAUDE.md) — "All server-side media fetches must call `assertSafeMediaUrl()`"
- [docs/solutions/infrastructure-patterns/blotato-oauth-token-refresh-encryption.md](./blotato-oauth-token-refresh-encryption.md) — OAuth token handling for the same publishing pipeline
