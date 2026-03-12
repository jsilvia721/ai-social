---
name: create-issue
description: Translate natural language task descriptions into well-structured GitHub issues optimized for the issue-worker agent
allowed-tools: Agent, Bash, Glob, Grep, Read
---

# Create Issue for Claude Code Pipeline

The user will describe one or more tasks they want done. Your job is to create GitHub issues that are **optimized for the issue-worker agent** to pick up and execute autonomously.

**Arguments:** $ARGUMENTS — the user's natural language description of what they want done.

## Process

### 1. Understand Intent

Parse the user's request. They may describe:
- A single task ("add a loading spinner to the posts page")
- Multiple tasks ("add dark mode toggle and also fix the broken avatar upload")
- A vague goal ("improve the accounts page performance")

If the request is vague or ambiguous, ask one clarifying question before proceeding. Don't over-ask — make reasonable assumptions and note them in the issue context.

If the request contains multiple independent tasks, create separate issues for each one.

### 2. Research the Codebase

Before writing the issue, research what the issue-worker will need to know:

- **Find relevant files** — use Glob and Grep to locate the code areas that will be touched. The worker starts cold; giving it precise file paths saves it exploration time and tokens.
- **Identify existing patterns** — if the task involves creating something new (endpoint, component, test), find a similar existing example the worker should follow.
- **Check for gotchas** — look at the schema, existing tests, and related code for constraints the worker needs to know about (e.g., "this model has a unique constraint on email", "this component uses server actions not API routes").
- **Check docs/solutions/** — look for any previously documented solutions relevant to this task.

### 3. Assess Complexity

Based on your research, classify the task:

| Tier | Criteria |
|------|----------|
| **Trivial** | Single file, obvious change, no decisions needed |
| **Moderate** | 2-5 files, clear approach, follows existing patterns |
| **Complex** | 6+ files, new patterns, schema changes, cross-cutting |

### 4. Write the Issue

Create the issue using `gh issue create` with this exact structure:

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
- `path/to/schema.prisma` — <if schema changes needed>
ISSUE_EOF
)"
```

## Quality Standards for Issues

The issue-worker reads the issue as its **sole instructions**. A well-written issue:

1. **Starts with a clear objective** — the worker should know exactly what "done" looks like after reading the first paragraph
2. **Points to specific files** — "follow the pattern in `src/app/api/posts/route.ts`" beats "follow existing API patterns"
3. **Includes behavioral details** — "returns 201 with `{ id, name, createdAt }`" beats "creates the resource"
4. **Specifies edge cases** — "reject if name is empty (400), reject if duplicate (409)" beats "handle errors"
5. **Notes schema implications** — if a Prisma model change is needed, say exactly what fields/relations to add
6. **Keeps scope tight** — one issue = one deliverable. If the user's request is broad, split into multiple issues and note dependencies

## Anti-patterns to Avoid

- **Don't be vague** — "improve performance" → "add database index on `Post.scheduledAt` and cache the dashboard query for 60s"
- **Don't assume knowledge** — the worker starts fresh each time, it doesn't remember previous issues
- **Don't overload** — a single issue shouldn't require more than ~10 files of changes. Split it up.
- **Don't skip acceptance criteria** — every issue needs testable criteria the worker can verify

## After Creating

After creating each issue, report back to the user with:
- Issue number and title
- Link to the issue
- Your complexity assessment
- Brief summary of what the worker will do

If you created multiple issues, list them all and note any ordering dependencies (e.g., "Issue #55 should be done before #56 because it adds the schema the second one depends on").
