# React Server Component Rules

Applies when working on async server components in `src/app/` or `src/components/`.

## `react-hooks/purity` Suppressions

The `react-hooks/purity` ESLint rule (React 19) flags non-idempotent calls like `Date.now()`, `Math.random()`, and `new Date()` inside component render bodies. In **async server components (RSC)**, these calls are expected and safe because:

- Server components execute **once per request** on the server — they are never re-rendered on the client.
- Fresh timestamps and dynamic values are needed for per-request data fetching (e.g., computing time ranges for metrics queries).

### When to suppress

Suppress `react-hooks/purity` only when **all** of these are true:

1. The component is an **async server component** (no `"use client"` directive, function is `async`).
2. The impure call is intentional for per-request freshness (e.g., `Date.now()` for time-based queries).
3. The value is not used in a way that would cause client-side inconsistency.

### eslint-disable format

Use a targeted inline disable with a justification:

```ts
// eslint-disable-next-line react-hooks/purity -- server component; fresh timestamp for metrics query
const since = new Date(Date.now() - DURATION_MS[range]);
```

Always include:
- The exact rule name: `react-hooks/purity`
- A comment starting with `server component;` followed by the specific reason

### When NOT to suppress

- In client components (`"use client"`) — the lint rule is correct; find an alternative (e.g., `useEffect`, `useState` with initial value from props).
- If the impure call can be moved to a server action, API route, or data-fetching function outside the component body.
