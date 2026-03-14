---
title: "feat: Integrate mission statement into brainstorm agent"
type: feat
status: active
date: 2026-03-14
origin: docs/brainstorms/2026-03-14-mission-statement-brainstorm.md
---

# feat: Integrate Mission Statement into Brainstorm Agent

## Overview

The project mission statement was finalized but currently lives only in Claude Code memory — it has zero influence on the brainstorm agent Lambda that generates roadmap ideas. This plan wires the mission statement and its four evaluation criteria into the agent's runtime prompts so every generated idea is evaluated against the project's purpose.

## Problem Statement

The brainstorm agent generates roadmap ideas hourly by reading `docs/brainstorm-context.md` (injected into `<vision>` tags) and using `BRAINSTORM_SYSTEM_PROMPT` as its system message. Neither contains the mission statement or evaluation criteria. The agent has no way to filter ideas by whether they serve the project's actual goals.

Additionally, the **iteration path** (when humans comment on brainstorm issues) uses a separate `BRAINSTORM_ITERATION_SYSTEM_PROMPT` and `buildIterationPrompt()` — neither of which receives the vision doc at all. Even after fixing generation, iteration would remain unguided.

## Proposed Solution

**Single source of truth:** Add the mission statement and four evaluation criteria to `docs/brainstorm-context.md`. Update system prompts to reference the vision doc generically rather than duplicating the mission. Fix the iteration path to also receive the vision doc.

### Changes

#### 1. `docs/brainstorm-context.md` — Add mission + criteria (highest leverage)

Add at the top of the file:

```markdown
## Mission

We build autonomous AI agents that make professional business capabilities accessible
to small teams, starting with social media. Our first agent researches trends, creates
content, publishes across platforms, and optimizes its own strategy — so small business
owners can grow their audience while focusing on what they actually do.

## Evaluation Criteria

Every roadmap idea should align with at least one of these:

1. **Audience growth** — Does this help small business owners grow their audience?
2. **Autonomy** — Does this reduce the need for human intervention?
3. **Accessibility** — Does this expand what's accessible to small teams?
4. **Full lifecycle** — Does this close gaps in the end-to-end content lifecycle?
```

Keep the existing sections (Business Vision, Current Capabilities, Success Criteria) below. Reconcile the existing "Success Criteria" section to reference the new criteria rather than conflict.

#### 2. `src/lib/brainstorm/prompts.ts` — Update system prompts

**`BRAINSTORM_SYSTEM_PROMPT`**: Update the role description from "product strategist specializing in social media management platforms" to reflect the mission framing (autonomous AI agents for small teams). Add instruction to evaluate every idea against the criteria in the `<vision>` document. Keep the existing security instruction intact.

**`buildGenerationPrompt()`**: Layer the mission criteria as strategic filters above the existing four tactical prioritization criteria. Add instruction: "Every idea must align with at least one evaluation criterion from the vision document."

**`BRAINSTORM_ITERATION_SYSTEM_PROMPT`**: Update role description to match the generation prompt's framing. Add instruction to evaluate feedback against the vision document's criteria.

#### 3. `src/lib/brainstorm/iterate.ts` — Pass vision doc to iteration path

Currently `iterateBrainstorm()` does not fetch the vision doc. Update it to:
1. Fetch `docs/brainstorm-context.md` from GitHub (same pattern as `generate.ts` line 88)
2. Pass it to `buildIterationPrompt()`

#### 4. `src/lib/brainstorm/prompts.ts` — Update `buildIterationPrompt()`

Update the function signature to accept the vision doc and inject it into the iteration prompt inside `<vision>` tags, mirroring the generation prompt pattern.

#### 5. `README.md` — Align tagline

Update the tagline from the current feature-focused description to reflect the mission. Something like:

> Autonomous AI agents that make professional business capabilities accessible to small teams — starting with social media management.

### What NOT to change

- **Tool schema**: Keep `visionAlignment` as a free-text field. Structured per-criterion scoring is premature — natural language guidance is sufficient.
- **Scoring thresholds**: Don't add minimum scores or rejection logic. Trust the prompt to guide Claude.
- **Existing tactical criteria**: Keep the four existing prioritization criteria (build on recent work, address gaps, span categories, be actionable). Layer mission criteria above them as strategic filters.

## Acceptance Criteria

- [ ] `docs/brainstorm-context.md` contains the mission statement and four evaluation criteria at the top
- [ ] `BRAINSTORM_SYSTEM_PROMPT` reflects mission framing, references vision doc for criteria
- [ ] `BRAINSTORM_ITERATION_SYSTEM_PROMPT` reflects mission framing, references vision doc
- [ ] `buildGenerationPrompt()` layers mission criteria above existing tactical criteria
- [ ] `buildIterationPrompt()` accepts and injects the vision doc in `<vision>` tags
- [ ] `iterateBrainstorm()` fetches vision doc from GitHub before calling `buildIterationPrompt()`
- [ ] README tagline updated to reflect mission
- [ ] Existing security instruction in system prompt preserved
- [ ] All existing tests pass; new/updated tests cover prompt changes and iteration vision injection
- [ ] `npm run ci:check` passes

## Technical Considerations

- **Prompt ordering**: Mission criteria should come before tactical criteria in the generation prompt so Claude treats them as higher priority
- **Vision doc fetch in iteration**: Use the same `github.getRepoFile()` pattern from `generate.ts` — handle the case where the file doesn't exist gracefully
- **No duplication**: The mission statement lives in `docs/brainstorm-context.md` only. System prompts reference "the vision document" generically so they don't drift from the source of truth
- **Existing `visionAlignment` field**: Claude will naturally populate this with mission-criterion-specific language once the prompt guides it — no schema change needed

## Sources & References

- **Origin brainstorm:** [docs/brainstorms/2026-03-14-mission-statement-brainstorm.md](docs/brainstorms/2026-03-14-mission-statement-brainstorm.md) — Key decisions: enablement over replacement, small business owners (1-5 people), social media as first vertical, outcome-oriented framing
- **Brainstorm agent entry point:** `src/cron/brainstorm.ts` → `src/lib/brainstorm/run.ts`
- **Vision doc injection:** `src/lib/brainstorm/generate.ts:88` — `github.getRepoFile("docs/brainstorm-context.md")`
- **System prompts:** `src/lib/brainstorm/prompts.ts:6-14` (generation), `prompts.ts:70-77` (iteration)
- **Iteration orchestrator:** `src/lib/brainstorm/iterate.ts`
- **Vision doc:** `docs/brainstorm-context.md`
