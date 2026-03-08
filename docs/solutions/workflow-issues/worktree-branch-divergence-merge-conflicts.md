---
title: "Git worktree branch switching causes stash pop conflicts when source branch diverges from staging"
date: "2026-03-08"
category: "workflow"
severity: "low"
component: "git-worktree-workflow"
symptoms:
  - "Merge conflicts when running git stash pop after branching from staging"
  - "Manual conflict resolution needed after switching branch base in worktree"
  - "Unrelated changes from source branch leak into new feature branch"
  - "Files missing imports or components present only on source branch"
tags:
  - "git"
  - "worktree"
  - "stash"
  - "branch-management"
  - "developer-workflow"
  - "staging"
related_issues: []
---

# Git Worktree Branch Divergence Causes Merge Conflicts

## Symptom

When working in a git worktree on branch A (e.g., `fix/missing-m3-migration`) and creating a new branch from `staging` to open a PR, running `git stash pop` produces merge conflicts because the source branch has diverged from staging.

Example conflict: `Sidebar.tsx` on branch A contains `showDevTools`, `LogOut`, `signOut` imports and props, while `staging` does not have these additions. The stash diff references context lines that don't exist on staging.

## Root Cause

Merge conflicts arise when uncommitted or stashed changes from one branch are applied onto a different branch that has diverged. The two branches have different file states, so `git stash pop` produces conflicts that require manual resolution.

`git stash` records changes relative to the branch HEAD where they were created. When the target branch has different surrounding code, the context lines don't match and conflicts result. Stash is **not** a portable clipboard between diverged branches.

## What Went Wrong (Anti-Pattern)

```bash
# ANTI-PATTERN: Stashing across diverged branches
git stash                              # on fix/missing-m3-migration
git checkout -b feat/new staging       # staging has different file state
git stash pop                          # CONFLICT — staging lacks code that
                                       # branch A added (showDevTools, LogOut, signOut)
```

## Working Solution

1. **Always start new work from a clean base branch.** Before beginning a new feature or fix, create a fresh branch directly from `staging`.
2. **Never carry uncommitted changes across branches.** If you have uncommitted work on branch A, either commit it there or discard it — do not stash-and-pop onto a different base.
3. **Use separate worktrees for separate tasks.** Each Claude Code worktree should be created from `staging` for its specific task.
4. **If you need specific commits from another branch,** use `git cherry-pick <sha>` instead of stashing.

### Correct Commands

```bash
# Start new feature from staging
git fetch origin staging
git checkout -b feat/new-feature origin/staging

# Create a new worktree from staging
git worktree add .claude/worktrees/my-task -b fix/my-task origin/staging

# If you need a specific commit from another branch
git cherry-pick <commit-sha>

# If you accidentally started work on the wrong branch (uncommitted)
git add -A
git commit -m "WIP: changes to move"
git checkout -b feat/correct-branch origin/staging
git cherry-pick <wip-commit-sha>
git reset HEAD~1  # unwrap the WIP commit, keep changes staged
```

### Verification

Before pushing or creating a PR, verify your branch descends from staging:

```bash
git merge-base --is-ancestor origin/staging HEAD && echo "OK: based on staging" || echo "WARNING: not based on staging"
```

## Prevention Checklist

1. Identify the PR target branch (almost always `staging`)
2. Fetch latest remote state — `git fetch origin staging`
3. Create the feature branch FROM the target — `git checkout -b fix/my-thing origin/staging`
4. Verify the base — `git log --oneline -3` should show staging's latest commits
5. Never carry uncommitted changes between branches with different bases

## Best Practices

- **Worktree creation**: Always specify base branch — `git worktree add .claude/worktrees/my-task -b fix/my-task origin/staging`
- **Keeping current**: If a worktree lives for hours, run `git fetch origin staging && git rebase origin/staging` before pushing
- **Cleanup**: After PR merge, remove stale worktrees — `git worktree remove .claude/worktrees/my-task`
