---
name: create-issue
description: Translate natural language task descriptions into well-structured GitHub issues optimized for the issue-worker agent, with intelligent decomposition for parallel execution
allowed-tools: Agent, Bash, Glob, Grep, Read
---

# Create Issue for Claude Code Pipeline

The user will describe tasks they want done. Your job is to create GitHub issues that are **optimized for the issue-worker agent** — right-sized for high success rates, minimal context window usage, and maximum parallelism when it makes sense.

**Arguments:** $ARGUMENTS — the user's natural language description of what they want done. May optionally include `--label <label-name>` to override the default `claude-plan-review` label on the created issue.

## Process

### 1. Understand Intent

Parse the user's request. If vague or ambiguous, ask one clarifying question before proceeding. Don't over-ask — make reasonable assumptions and note them in the issue context.

**Label parsing:** Check if the arguments include `--label <name>`. If present, extract the label name and remove the flag from the task description. If not present, default to `claude-plan-review`.

### 2. Research the Codebase

Before making any decomposition decisions, research thoroughly:

- **Find relevant files** — use Glob and Grep to locate the code areas that will be touched. The worker starts cold; giving it precise file paths saves exploration time and tokens.
- **Identify existing patterns** — find similar existing examples the worker should follow.
- **Check for gotchas** — schema constraints, test patterns, related code the worker needs to know about.
- **Check docs/solutions/** — look for previously documented solutions relevant to this task.
- **Map dependencies** — understand which files and modules depend on each other. This is critical for decomposition decisions.

### 3. Decomposition Analysis

This is the key step. Evaluate whether the task should be kept as a single issue or split into multiple parallel issues.

**Run this decision framework:**

#### A. Estimate the scope
- Count the files that need to change
- Identify how many distinct "layers" are involved (schema, API, UI, tests)
- Estimate how many lines of code will change

#### B. Check the splitting criteria

**KEEP AS ONE ISSUE when:**
- Total scope is ≤5 files and changes are tightly coupled (e.g., "add API endpoint + its tests")
- Splitting would create dependencies that force serial execution anyway
- The task is inherently atomic (e.g., a schema migration that multiple features depend on)
- The overhead of coordinating split issues exceeds the benefit (trivial tasks)
- Changes touch shared state that would cause merge conflicts if done in parallel

**SPLIT INTO MULTIPLE ISSUES when:**
- The task spans independent layers that don't share files (e.g., "new API endpoint" + "new UI page that calls it" can be split if the API contract is defined upfront)
- Multiple independent features are bundled in one request ("add X and also fix Y")
- The total scope exceeds ~8 files or ~300 lines of changes — larger tasks have lower success rates
- Parts of the work have different complexity tiers (don't make the worker do a Complex workflow for a task that's 80% Trivial)
- There are independent subtasks that can genuinely run in parallel without merge conflicts

#### C. If splitting, design the decomposition

For each potential split, verify:

1. **No file overlap** — two parallel issues should NOT modify the same file. If they must, they can't be parallel.
2. **Clear contract boundaries** — if issue B depends on issue A's output (e.g., a new DB model), define the interface/schema in issue A and reference it in issue B.
3. **Independent testability** — each issue must be independently testable and pass ci:check on its own.
4. **Minimal shared context** — each issue should be self-contained. Don't make one issue's instructions reference another issue's details.

#### D. Assign execution strategy

For each issue (whether split or not), determine:

| Strategy | When | Label |
|----------|------|-------|
| **Parallel** | No file overlap, no data dependency | `needs-triage` (all at once) |
| **Sequential** | Issue B depends on Issue A's output | `needs-triage` on A only; note in B: "Depends on #N — label `needs-triage` after #N merges" |
| **Single** | Keep as one issue | `needs-triage` |

### 4. Assess Complexity (per issue)

| Tier | Criteria |
|------|----------|
| **Trivial** | Single file, obvious change, no decisions needed |
| **Moderate** | 2-5 files, clear approach, follows existing patterns |
| **Complex** | 6+ files, new patterns, schema changes, cross-cutting |

### 5. Write the Plan Issue

Create a **single plan issue** for human review. This issue contains all the work items structured for the plan-executor agent to parse after approval.

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
- **Acceptance Criteria:**
  - [ ] <...>
<!-- PLAN_ITEMS_END -->

### Execution Strategy

| # | Title | Complexity | Strategy | Depends On |
|---|-------|------------|----------|------------|
| 1 | <title> | <complexity> | Parallel | — |
| 2 | <title> | <complexity> | Sequential | 1 |
ISSUE_EOF
)"
```

**Important:**
- Use the parsed label (default: `claude-plan-review`). Do NOT use `claude-ready` or `needs-triage` unless explicitly passed via `--label`
- When a custom label is provided via `--label`, the issue follows that label's workflow instead of the standard plan-review pipeline
- Items with `Depends on: none` will get `needs-triage` when created by the plan-executor (requires human approval to become `claude-ready`)
- Items with dependencies will wait until their dependencies are merged
- Include ALL detail the worker will need — the plan-executor preserves it verbatim

## Quality Standards

The issue-worker reads the issue as its **sole instructions**. A well-written issue:

1. **Starts with a clear objective** — the worker should know exactly what "done" looks like after the first paragraph
2. **Points to specific files** — `src/app/api/posts/route.ts` beats "the posts API"
3. **Includes behavioral details** — "returns 201 with `{ id, name, createdAt }`" beats "creates the resource"
4. **Specifies edge cases** — "reject if name is empty (400), reject if duplicate (409)" beats "handle errors"
5. **Is self-contained** — the worker doesn't read other issues. Everything it needs is in this one issue.
6. **Stays focused** — one issue = one deliverable, ≤8 files changed, one clear objective

## After Creating

Report back to the user with:

1. A link to the plan issue on GitHub
2. The execution strategy table from the issue body
3. Your decomposition reasoning (why you split or kept as one)
4. Total estimated files touched across all items
5. Instruction: **"Review the plan on GitHub and comment `/approve` to kick off work."**
