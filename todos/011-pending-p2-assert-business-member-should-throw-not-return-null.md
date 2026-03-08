---
status: pending
priority: p2
issue_id: "011"
tags: [code-review, security, architecture, typescript]
dependencies: []
---

# P2 — `assertBusinessMember` Should Throw, Not Return `null`

## Problem Statement

The plan names the helper `assertBusinessMember` but implements it as a function that returns `null` on failure. The name implies it throws/asserts. Every callsite must remember to check the return value — if a developer forgets, `result.business` throws a runtime error rather than a 404, and the route continues processing with an unauthorized user.

This is a naming mismatch that creates a security footgun as more routes are added in M2.

## Findings

- Source: security-sentinel (P2-3), architecture-strategist (Finding 4), kieran-typescript-reviewer (Finding 5)
- The TypeScript return type `{ member, business } | null` requires a null check but TypeScript won't error if the developer accesses `result.business` on an unnarrowed value in all editor configurations
- Architecture review: `POST /api/posts` uses an inline duplicate check rather than calling `assertBusinessMember()`, showing the inconsistency is already emerging
- Security review: the name "assert" implies a throwing guard — return-null is a different contract

## Proposed Solutions

### Option A — Rename to throwing form (Recommended)
```typescript
export class BusinessAccessDeniedError extends Error {
  constructor(businessId?: string) {
    super(businessId ? `Not a member of business ${businessId}` : "Business not found");
    this.name = "BusinessAccessDeniedError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export async function requireBusinessMember(
  businessId: string | null | undefined,
  userId: string,
): Promise<{ member: BusinessMember & { business: Business }; business: Business }> {
  if (!businessId) throw new BusinessAccessDeniedError();
  const member = await prisma.businessMember.findFirst({
    where: { businessId, userId },
    include: { business: true },
  });
  if (!member) throw new BusinessAccessDeniedError(businessId);
  return { member, business: member.business };
}
```

In each route:
```typescript
try {
  const { business } = await requireBusinessMember(params.id, session.user.id);
  // ... proceed
} catch (e) {
  if (e instanceof BusinessAccessDeniedError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  throw e;
}
```

Keep the nullable variant as `findBusinessMember()` for the layout middleware where null is appropriate.

**Pros:** Impossible to accidentally bypass. Compile-time safety. Consistent naming.
**Cons:** Requires try/catch in every route.
**Effort:** Small | **Risk:** Low

### Option B — Keep null return, rename to `findBusinessMember`
Rename the function so callers know it returns null. Document the null-check requirement.

**Pros:** Less boilerplate (no try/catch).
**Cons:** Still relies on developer discipline.
**Effort:** Tiny | **Risk:** Medium

## Recommended Action

Option A — rename to `requireBusinessMember`, throwing form. Add `findBusinessMember` as the nullable variant for the layout.

## Technical Details

- **Affected files:** `src/lib/businesses.ts`, all API routes that use the helper
- **Plan phase:** Phase 6

## Acceptance Criteria

- [ ] `requireBusinessMember()` throws `BusinessAccessDeniedError` on non-member
- [ ] `findBusinessMember()` retains the nullable return for layout use
- [ ] `BusinessAccessDeniedError` has `Object.setPrototypeOf` fix
- [ ] All business-scoped API routes use `requireBusinessMember()` in a try/catch
- [ ] Zero routes access `result.business` without narrowing

## Work Log

- 2026-03-07: Identified by security-sentinel (P2-3), architecture-strategist (Finding 4), kieran-typescript-reviewer (Finding 5) during plan review
