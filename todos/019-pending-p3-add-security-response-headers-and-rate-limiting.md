---
status: pending
priority: p3
issue_id: "019"
tags: [code-review, security, owasp]
dependencies: []
---

# P3 — Missing Security Response Headers + No Rate Limiting on Business Creation

## Problem Statement

Two security gaps not addressed in the plan:

1. **No security response headers** — `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options` are not set anywhere. This is OWASP A05 (Security Misconfiguration) — the only Top 10 category the plan doesn't address.

2. **No rate limiting on `POST /api/businesses`** — creating a business triggers a Claude `tool_use` call (max_tokens: 2048). An authenticated user can call this endpoint in a loop, burning Anthropic quota. With `ALLOWED_EMAILS` restricted to 2 people this is low risk now, but the plan has no guard.

## Findings

- Source: security-sentinel (P3-4, Security Requirements checklist)
- Next.js `next.config.ts` `headers()` function is the standard way to set response headers in App Router
- A simple per-user business count check (`count >= 50`) is sufficient quota protection for M1

## Proposed Solutions

### Fix 1 — Security headers via `next.config.ts`
```typescript
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // Next.js requires these
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "connect-src 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};
```

### Fix 2 — Business creation rate limit
```typescript
// In POST /api/businesses:
const ownedCount = await prisma.businessMember.count({
  where: { userId: session.user.id, role: "OWNER" },
});
if (ownedCount >= 50) {
  return NextResponse.json({ error: "Business limit reached" }, { status: 429 });
}
```

**Effort:** Small | **Risk:** Low

## Recommended Action

Add both during Phase 6 implementation. Security headers are a one-time addition to `next.config.ts`.

## Technical Details

- **Affected files:** `next.config.ts`, `src/app/api/businesses/route.ts`
- **Plan phase:** Phase 6

## Acceptance Criteria

- [ ] `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy` set via `next.config.ts` headers
- [ ] `POST /api/businesses` checks owned business count; returns 429 if ≥ 50
- [ ] Security headers verified present in production response

## Work Log

- 2026-03-07: Identified by security-sentinel (P3-4, OWASP checklist) during plan review
