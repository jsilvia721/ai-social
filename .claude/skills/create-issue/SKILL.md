---
name: create-issue
description: Translate natural language task descriptions into well-structured GitHub issues optimized for the issue-worker agent, with intelligent decomposition for parallel execution
allowed-tools: Agent, Bash, Glob, Grep, Read
---

# Create Issue for Claude Code Pipeline

The user will describe tasks they want done. Your job is to create GitHub issues that are **optimized for the issue-worker agent** — right-sized for high success rates, minimal context window usage, and maximum parallelism when it makes sense.

**Arguments:** $ARGUMENTS — the user's natural language description of what they want done.

## Process

### 1. Understand Intent

Parse the user's request. If vague or ambiguous, ask one clarifying question before proceeding. Don't over-ask — make reasonable assumptions and note them in the issue context.

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
| **Parallel** | No file overlap, no data dependency | `claude-ready` (all at once) |
| **Sequential** | Issue B depends on Issue A's output | `claude-ready` on A only; note in B: "Depends on #N — label `claude-ready` after #N merges" |
| **Single** | Keep as one issue | `claude-ready` |

### 4. Assess Complexity (per issue)

| Tier | Criteria |
|------|----------|
| **Trivial** | Single file, obvious change, no decisions needed |
| **Moderate** | 2-5 files, clear approach, follows existing patterns |
| **Complex** | 6+ files, new patterns, schema changes, cross-cutting |

### 5. Write the Issues

Create each issue using `gh issue create` with this structure:

```bash
gh issue create \
  --title "<imperative verb> <concise description>" \
  --label "claude-ready" \
  --body "$(cat <<'ISSUE_EOF'
### Objective

<What should be accomplished. Be specific about the desired end state. Include behavioral details — what the user should see, what the API should return, what the test should assert. Don't leave room for interpretation.>

### Context

<Background the worker needs. Include:>
- <Existing patterns to follow (with file paths)>
- <Architectural constraints or conventions>
- <Any gotchas discovered during research>
- <Related docs/solutions if applicable>

### Acceptance Criteria

- [ ] <Specific, verifiable criterion>
- [ ] <Another criterion>
- [ ] Tests cover happy path and error cases
- [ ] `npm run ci:check` passes

### Complexity Hint

<Trivial|Moderate|Complex>

### Relevant Files

- `path/to/file.ts` — <what to do with it>
- `path/to/pattern.ts` — <follow this as a reference>
ISSUE_EOF
)"
```

For **sequential** issues that depend on a prior issue, omit the `claude-ready` label and add a dependency note:

```
### Dependencies

> ⚠️ **Do not start until #<number> is merged.** This issue depends on <what it provides>.
> Once merged, add the `claude-ready` label to this issue.
```

## Quality Standards

The issue-worker reads the issue as its **sole instructions**. A well-written issue:

1. **Starts with a clear objective** — the worker should know exactly what "done" looks like after the first paragraph
2. **Points to specific files** — `src/app/api/posts/route.ts` beats "the posts API"
3. **Includes behavioral details** — "returns 201 with `{ id, name, createdAt }`" beats "creates the resource"
4. **Specifies edge cases** — "reject if name is empty (400), reject if duplicate (409)" beats "handle errors"
5. **Is self-contained** — the worker doesn't read other issues. Everything it needs is in this one issue.
6. **Stays focused** — one issue = one deliverable, ≤8 files changed, one clear objective

## After Creating

Report back to the user with a summary table:

```
| # | Title | Complexity | Strategy | Depends On |
|---|-------|------------|----------|------------|
| 55 | Add Widget model and migration | Moderate | Parallel | — |
| 56 | Add POST /api/widgets endpoint | Moderate | Parallel | — |
| 57 | Add widget management UI page | Complex | Sequential | #55, #56 |
```

Include:
- Your decomposition reasoning (why you split or kept as one)
- Which issues can run in parallel vs. which must wait
- Total estimated files touched across all issues
