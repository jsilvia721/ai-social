---
paths:
  - "src/__tests__/**"
  - "jest.config.*"
---

# Testing Conventions

## Setup
`src/__tests__/setup.ts` runs via `setupFiles` (before module import) to populate env vars so `src/env.ts` Zod parse doesn't throw. `AWS_S3_PUBLIC_URL` is set to `https://storage.example.com` — test media URLs must use this prefix to pass the SSRF guard.

## Coverage Thresholds (enforced in CI)
75% statements/lines/branches, 70% functions.

### Excluded from coverage
`src/components/**`, `src/cron/**`, `src/lib/auth.ts`, `src/lib/db.ts`, `src/lib/storage.ts`, `src/lib/utils.ts`, pages, layouts, shadcn/ui, providers, types.

## Mocking

**Prisma mock pattern** — copy this exactly:
```ts
import { prismaMock } from "@/__tests__/mocks/prisma";
jest.mock("@/lib/db", () => ({ prisma: prismaMock }));
beforeEach(() => mockReset(prismaMock));
```

- HTTP: spy on `global.fetch` — do NOT use `msw` or other interceptors
- All tests run in `node` environment (not jsdom)
- `src/cron/*.ts` Lambda handlers are intentionally not unit-tested (thin wrappers)

## Testing SSE/Streaming Components in jsdom

When testing API routes or components that use Server-Sent Events (SSE) or streaming responses with `ReadableStream`, jsdom needs polyfills since it lacks Web Streams API support.

### Required polyfills

For **jsdom** test environment (`@jest-environment jsdom`), add these at the top of your test file:

```ts
import { TextEncoder, TextDecoder } from "util";
import { ReadableStream } from "stream/web";

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;
global.ReadableStream = ReadableStream as typeof global.ReadableStream;
```

If the component scrolls (e.g., chat UIs), also mock `scrollIntoView`:

```ts
Element.prototype.scrollIntoView = jest.fn();
```

> **Note:** Tests using the `node` environment (default for this project) already have `TextEncoder`, `TextDecoder`, and `ReadableStream` available — polyfills are only needed for jsdom.

### ⚠️ Do NOT use `jest.useFakeTimers()` with ReadableStream

Fake timers cause indefinite hangs when combined with async `ReadableStream` consumption (e.g., `reader.read()` never resolves). Always use **real timers** in tests that read from streams. If your test file mixes stream tests with timer-dependent tests, call `jest.useRealTimers()` before the streaming tests.

### Mock SSE response helper

Use this pattern to create mock SSE streaming responses for testing:

```ts
interface SSEEvent {
  type: "text" | "error" | "done" | "unknown";
  data: string;
}

async function readSSEStream(
  response: Response
): Promise<{ events: SSEEvent[]; raw: string }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  const events: SSEEvent[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }

  const lines = raw.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      const data = line.slice(6);
      if (data === "[DONE]") {
        events.push({ type: "done", data });
      } else {
        try {
          const parsed = JSON.parse(data);
          events.push({ type: parsed.type ?? "unknown", data });
        } catch {
          events.push({ type: "unknown", data });
        }
      }
    }
  }

  return { events, raw };
}
```

### Reference

See `src/__tests__/api/feedback-chat.test.ts` for a complete working example of SSE stream testing with mock Anthropic SDK streams.
