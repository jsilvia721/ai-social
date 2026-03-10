---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, security, ai, input-validation]
dependencies: []
---

# P1 — `wizardAnswers` Fed to Claude Without Validation — Prompt Injection Risk

## Problem Statement

`POST /api/businesses/[id]/onboard` accepts `wizardAnswers: Record<string, string>` from the request body and passes it directly to `buildOnboardingPrompt()` which constructs the Claude message. There is no server-side Zod validation on `wizardAnswers`. An authenticated user can inject prompt instructions via any field value, burn excessive Anthropic quota via oversized payloads, or cause Claude to store attacker-controlled content in the `ContentStrategy` DB record.

## Findings

- Source: security-sentinel (P1-3)
- `tool_choice: { type: "any" }` makes free-text jailbreak harder (forces a tool call) but doesn't prevent injected text from influencing tool input values
- The `ContentStrategy` record could store injected content (e.g., `optimizationGoal` set to a URL or script tag) that is later rendered or used in AI prompts
- No field-level length limits — a 100KB `industry` string burns Anthropic quota
- Extra unknown keys are silently ignored by `Record<string, string>` — validate and reject unexpected keys

## Proposed Solutions

### Option A — Strict Zod schema for `wizardAnswers` (Recommended)
```typescript
const WizardAnswersSchema = z.object({
  businessDescription: z.string().max(1000).trim(),
  targetAudience: z.string().max(500).trim(),
  industry: z.string().max(200).trim(),
  contentGoals: z.string().max(500).trim(),
  brandPersonality: z.string().max(500).trim(),
}).strict(); // reject extra keys

// In route handler:
const body = await req.json();
const answers = WizardAnswersSchema.safeParse(body.wizardAnswers);
if (!answers.success) {
  return NextResponse.json({ error: "Invalid wizard answers" }, { status: 400 });
}
// Pass answers.data to buildOnboardingPrompt()
```

Total input cap: ~2,700 chars — reasonable for Claude with few-shot examples.

**Pros:** Eliminates injection surface. Quota protection. Type-safe.
**Cons:** Must match the actual wizard form fields.
**Effort:** Small | **Risk:** Low

### Option B — Strip HTML tags and limit total size only
Sanitize inputs without strict schema. Allows unknown keys.

**Pros:** More flexible if wizard fields change.
**Cons:** Doesn't prevent unknown key injection. Weaker.
**Effort:** Small | **Risk:** Medium

## Recommended Action

Option A — define the schema to match the wizard form fields exactly. Fields can be relaxed later but starting strict is safer.

## Technical Details

- **Affected files:** `src/app/api/businesses/[id]/onboard/route.ts`, `src/lib/ai/index.ts`
- **Plan phase:** Phase 7

## Acceptance Criteria

- [ ] `WizardAnswersSchema` defined with `.strict()` — rejects unknown keys
- [ ] Each field has a max length (1,000 chars max for any single field)
- [ ] Handler validates input before passing to `buildOnboardingPrompt()`
- [ ] Test: oversized payload returns 400; unknown keys return 400; valid payload succeeds

## Work Log

- 2026-03-07: Identified by security-sentinel (P1-3) during plan review
