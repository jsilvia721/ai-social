---
title: PR opened without rebasing from target branch
category: workflow-issues
tags: [git, branching, pr-workflow, worktrees, rebase]
module: git-workflow
symptom: "PR created on a stale base, missing recent commits merged into target branch"
root_cause: "Skipped git fetch + rebase before pushing and creating the PR"
severity: medium
date: 2026-03-08
---

# PR Opened Without Rebasing from origin/staging

## Problem

PR #24 was opened on the `feat/ai-fulfillment-engine` branch without first rebasing onto the latest `origin/staging`. After PR #23 was merged, a new commit was added to the same branch and pushed without fetching/rebasing. The push succeeded because there were no conflicting changes — but this was luck, not correctness.

The CLAUDE.md workflow explicitly requires:
- `git fetch origin staging` before pushing
- `git merge-base --is-ancestor origin/staging HEAD` to verify ancestry
- Resolving any conflicts before creating the PR

## Root Cause

The PR creation flow jumped straight to `git add` / `git commit` / `git push` / `gh pr create` without the rebase steps. The verification command (`git merge-base`) was also skipped.

## What Can Go Wrong If Skipped

1. **Silent merge conflicts** — branch merges cleanly at the Git level but produces broken code
2. **CI passes on branch, fails after merge** — tests run against stale base, not latest staging
3. **Broken staging deployments** — staging auto-deploys, incompatible code breaks the environment
4. **Divergent history** — complicates `git bisect` and `git revert`

## Correct Pre-PR Workflow

Every time before opening or updating a PR:

```bash
# 1. Fetch latest staging
git fetch origin staging

# 2. Rebase onto staging
git rebase origin/staging
# Resolve conflicts if any, then: git rebase --continue

# 3. Verify ancestry (exits 0 if correct)
git merge-base --is-ancestor origin/staging HEAD

# 4. Run CI checks (rebase can introduce subtle breakage)
npm run ci:check

# 5. Push (use --force-with-lease if branch was already pushed)
git push -u origin <branch-name>
# or: git push --force-with-lease  (if rebased an already-pushed branch)

# 6. Create PR targeting staging
gh pr create --base staging --title "..." --body "..."
```

## Prevention

- **Treat the pre-PR checklist as a hard gate**, not optional
- The `git merge-base` verification must run before every `git push` when preparing a PR
- If a previous PR on the same branch was already merged, the branch may have been deleted on the remote — always rebase before re-pushing

## Related

- [Worktree branch divergence and merge conflicts](./worktree-branch-divergence-merge-conflicts.md)
- CLAUDE.md "Branching & Worktrees" section
- MEMORY.md "Git Branching (Critical)" section
