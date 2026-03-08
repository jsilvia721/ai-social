---
status: pending
priority: p1
issue_id: "001"
tags: [code-review, architecture, performance, auth, nextauth]
dependencies: []
---

# P1 — JWT Callback Never Writes `activeBusinessId` to Token

## Problem Statement

The plan's session callback reads `token.activeBusinessId` to hydrate `session.user.activeBusinessId`, but nothing in the plan writes `activeBusinessId` into the JWT token itself. Under NextAuth JWT strategy, the `session` callback fires on **every** call to `getServerSession()`. Because `token.activeBusinessId` is always `undefined` (never persisted), the `else` branch hits `prisma.businessMember.findFirst()` on every single request — one Neon HTTP round-trip per page load, per API call, in every Lambda invocation.

This is a silent performance regression that only surfaces as latency growth in production.

## Findings

- Source: performance-oracle, kieran-typescript-reviewer, architecture-strategist
- The `session` callback cannot persist data back to the JWT token — only the `jwt` callback can
- The plan conflates the two callbacks: hydration logic belongs in `jwt`, not `session`
- Additionally: after a business switch, stale `activeBusinessId` in JWT persists for up to 30 days if the `jwt` callback doesn't handle `trigger === "update"`
- The `POST /api/businesses/switch` endpoint says it "updates JWT token" but NextAuth JWT cookies are immutable from API routes — the client must call `useSession().update()` to trigger a JWT rewrite
- Missing: `JWT` interface not augmented in `next-auth.d.ts` alongside `Session`, causing `token.activeBusinessId as string` cast to mask type gap

## Proposed Solutions

### Option A — Move hydration to `jwt` callback (Recommended)
```typescript
// src/lib/auth.ts
async jwt({ token, user, trigger, session: sessionData }) {
  if (user) {
    token.sub = user.id;
    const first = await prisma.businessMember.findFirst({
      where: { userId: user.id, role: "OWNER" },
      select: { businessId: true },
      orderBy: { joinedAt: "asc" },
    });
    token.activeBusinessId = first?.businessId ?? null;
  }
  if (trigger === "update" && sessionData?.activeBusinessId) {
    token.activeBusinessId = sessionData.activeBusinessId;
  }
  return token;
},
async session({ session, token }) {
  session.user.id = token.sub!;
  session.user.activeBusinessId = (token.activeBusinessId as string) ?? null;
  return session;
},
```

Client-side switch:
```typescript
// After POST /api/businesses/switch returns 200
const { update } = useSession();
await update({ activeBusinessId: newBusinessId });
```

Augment both interfaces in `next-auth.d.ts`:
```typescript
declare module "next-auth/jwt" {
  interface JWT {
    activeBusinessId?: string | null;
  }
}
```

**Pros:** Zero DB queries on per-request session reads. JWT cache is correct.
**Cons:** First sign-in still incurs one DB query.
**Effort:** Small | **Risk:** Low

### Option B — Always re-validate membership on session
Always call `prisma.businessMember.findFirst()` in the `session` callback, even when `token.activeBusinessId` is set, to detect revoked memberships.

**Pros:** Handles membership revocation within seconds.
**Cons:** Every request hits Neon. Acceptable for 2-person team; not for scale.
**Effort:** Small | **Risk:** Low

## Recommended Action

Option A. Eliminates the per-request DB query. Add membership re-validation (Option B) inside the `jwt` callback with a short TTL check if revocation handling matters in M2.

## Technical Details

- **Affected files:** `src/lib/auth.ts`, `src/types/next-auth.d.ts`, business selector client component
- **Plan phase:** Phase 5

## Acceptance Criteria

- [ ] `jwt` callback writes `activeBusinessId` to token on sign-in and on `trigger === "update"`
- [ ] `session` callback reads `activeBusinessId` from token only, no DB query
- [ ] `JWT` interface augmented in `next-auth.d.ts`
- [ ] `POST /api/businesses/switch` returns 200; client calls `useSession().update()`
- [ ] `token.activeBusinessId as string` cast removed — type-safe via augmentation

## Work Log

- 2026-03-07: Identified by performance-oracle, kieran-typescript-reviewer, architecture-strategist during plan review
