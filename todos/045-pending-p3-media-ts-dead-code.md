---
status: closed
priority: p3
issue_id: "045"
tags: [code-review, simplicity, fulfillment-engine]
dependencies: []
---

# Dead Code in media.ts — AbortController/Timeout Around Mock

## Problem Statement

`generateImage()` in `src/lib/media.ts:25-36` creates an AbortController, sets a timeout, sanitizes the prompt, then calls `mockGenerateImage(sanitized)` regardless. The entire try/finally with controller/timeout is dead code since no real provider exists yet.

## Proposed Solutions

Simplify to just delegate to mock with a TODO:
```typescript
export async function generateImage(prompt: string): Promise<GeneratedImage> {
  if (shouldMockExternalApis()) {
    return mockGenerateImage(prompt);
  }
  // TODO: Replace with actual provider (Gemini/OpenAI/Replicate)
  return mockGenerateImage(prompt);
}
```

Add sanitization and timeout when a real provider is wired in.

- Effort: Trivial

## Work Log

- 2026-03-08: Created from code review
