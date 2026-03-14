---
name: create-issue
description: Translate natural language task descriptions into well-structured GitHub issues optimized for the issue-worker agent, with intelligent decomposition for parallel execution
allowed-tools: Agent, Bash, Glob, Grep, Read
---

# Create Issue for Claude Code Pipeline

The user will describe tasks they want done. Create GitHub issues **optimized for the issue-worker agent** — right-sized for high success rates, minimal context window usage, and maximum parallelism.

**Arguments:** $ARGUMENTS — the user's natural language description. May include `--label <label-name>` to override the default `claude-plan-review` label.

## Process

### 1. Understand Intent

Parse the request. If vague, ask one clarifying question. Make reasonable assumptions and note them in the issue context.

**Label parsing:** Extract `--label <name>` if present (default: `claude-plan-review`).

### 2. Research the Codebase

Use Glob and Grep to: find relevant files (precise paths save worker time), identify existing patterns to follow, check for gotchas (schema constraints, test patterns), search `docs/solutions/`, and map dependencies (critical for decomposition).

### 3. Decomposition Analysis

#### A. Estimate scope
Count files, identify layers (schema, API, UI, tests), estimate lines changed.

#### B. Check splitting criteria

**KEEP AS ONE** when ≤5 tightly coupled files, splitting forces serial execution, task is atomic, or changes touch shared state causing conflicts.

**SPLIT** when independent layers don't share files, multiple features are bundled, scope exceeds ~8 files/~300 lines, or subtasks can genuinely run in parallel.

#### C. If splitting, verify per split:
1. **No file overlap** between parallel issues
2. **Clear contract boundaries** between dependent issues
3. **Independent testability** — each passes ci:check alone
4. **Minimal shared context** — each is self-contained

#### D. Assign execution strategy

| Strategy | When | Label |
|----------|------|-------|
| **Parallel** | No file overlap, no data dependency | `needs-triage` (all at once) |
| **Sequential** | Issue B depends on A's output | `needs-triage` on A; note in B: "Depends on #N" |
| **Single** | Keep as one issue | `needs-triage` |

### 4. Assess Complexity (per issue)

| Tier | Criteria |
|------|----------|
| **Trivial** | Single file, obvious change, no decisions needed |
| **Moderate** | 2-5 files, clear approach, follows existing patterns |
| **Complex** | 6+ files, new patterns, schema changes, cross-cutting |

### 5. Write the Plan Issue

```bash
gh issue create \
  --title "Plan: <concise description of the overall task>" \
  --label "<parsed-label>" \
  --body "$(cat <<'ISSUE_EOF'
### Plan: <title>

<High-level description of the task and what will be accomplished.>

### Research Summary

<Key findings from codebase exploration — patterns found, constraints identified, files involved.>

<!-- To edit this plan: modify titles, objectives, criteria, or reorder items freely.
     Keep the PLAN_ITEMS_START/END markers and the #### numbering format intact.
     The plan-executor parses these markers to create work issues. -->

<!-- PLAN_ITEMS_START -->
#### 1. <title>
- **Complexity:** <Trivial|Moderate|Complex>
- **Depends on:** none
- **Files:** `path/to/file.ts`, `path/to/other.ts`
- **Objective:** <What should be accomplished. Be specific about the desired end state.>
- **Context:** <Background the worker needs — existing patterns, constraints, gotchas.>
- **Acceptance Criteria:**
  - [ ] <Specific, verifiable criterion>
  - [ ] <Another criterion>
  - [ ] Tests cover happy path and error cases
  - [ ] `npm run ci:check` passes

#### 2. <title>
- **Complexity:** <Trivial|Moderate|Complex>
- **Depends on:** 1
- **Files:** `path/to/file.ts`
- **Objective:** <...>
- **Context:** <...>
- **Acceptance Criteria:** <...>
<!-- PLAN_ITEMS_END -->

### Execution Strategy

| # | Title | Complexity | Strategy | Depends On |
|---|-------|------------|----------|------------|
| 1 | <title> | <complexity> | Parallel | — |
| 2 | <title> | <complexity> | Sequential | 1 |
ISSUE_EOF
)"
```

**Important:** Use the parsed label (default: `claude-plan-review`). Do NOT use `claude-ready` or `needs-triage` unless explicitly passed via `--label`. Include ALL detail the worker needs — the plan-executor preserves it verbatim.

## Quality Standards

- [ ] Clear objective — worker knows "done" after the first paragraph
- [ ] Specific file paths — `src/app/api/posts/route.ts` not "the posts API"
- [ ] Behavioral details — "returns 201 with `{ id, name, createdAt }`" not "creates the resource"
- [ ] Edge cases specified — "reject if empty (400), reject if duplicate (409)" not "handle errors"
- [ ] Self-contained — worker doesn't read other issues
- [ ] Focused — one deliverable, ≤8 files changed

## After Creating

Report back with: the plan issue link, the execution strategy table, and the instruction: **"Review the plan on GitHub and comment `/go` (or `/approve` or 👍) to kick off work."**
