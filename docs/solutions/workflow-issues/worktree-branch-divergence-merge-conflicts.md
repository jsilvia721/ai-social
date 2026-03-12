---
title: "Worktree branch divergence causing PR merge conflicts"
date: "2026-03-08"
category: workflow-issues
severity: "high"
module: git-branching
symptom: "Merge conflicts on PR when target branch has diverged, or stash pop conflicts when switching branch base"
root_cause: "New branches created from current HEAD or another feature branch instead of from origin/main"
component: "git-branching"
symptoms:
  - "Merge conflicts on PR when target branch (main) has diverged"
  - "Merge conflicts when running git stash pop after branching from main"
  - "Manual conflict resolution needed after switching branch base in worktree"
  - "Unrelated changes from source branch leak into new feature branch"
  - "Files missing imports or components present only on source branch"
  - "PR shows many more commits than expected (carrying parent branch history)"
tags:
  - git
  - worktree
  - stash
  - branch-management
  - developer-workflow
  - merge-conflicts
  - pr-workflow
related_issues: []
---

# Git Worktree Branch Divergence Causes Merge Conflicts

## Symptom

There are two manifestations of this problem:

### 1. PR merge conflicts (most common)

A feature branch is created from another feature branch (or from an outdated local ref) instead of from `origin/staging`. When the PR is opened against staging, GitHub reports merge conflicts because staging has diverged.

Example (PR #22): `feat/mock-external-apis` was branched from `feat/sign-out`. The Sidebar.tsx file had conflicting import lines between the two branches and staging. An earlier attempt to rebase onto `origin/main` failed entirely because many files modified on the branch didn't exist on main (blotato/, briefs.ts, research.ts, etc.).

### 2. Stash pop conflicts

When working in a git worktree on branch A and creating a new branch from `staging`, running `git stash pop` produces merge conflicts because the source branch has diverged from staging.

## Root Cause

New branches get created from the currently checked-out branch rather than explicitly from the PR target base (`origin/staging`). This happens when:

- Working in a worktree that's on a feature branch and running `git checkout -b feat/new` without specifying a start point
- Using `git worktree add` without an explicit base ref
- Branching from a stale local `staging` that hasn't been fetched recently

The branch carries forward all unmerged commits from the parent feature branch, creating divergence with the actual target base.

For stash conflicts specifically: `git stash` records changes relative to the branch HEAD where they were created. When the target branch has different surrounding code, the context lines don't match.

## What Went Wrong (Anti-Patterns)

```bash
# ANTI-PATTERN 1: Branching from current HEAD (which is a feature branch)
# You're on feat/sign-out and create a new branch
git checkout -b feat/new-feature        # branches from feat/sign-out, NOT staging
git push -u origin feat/new-feature
gh pr create --base staging             # CONFLICT — carries feat/sign-out's commits

# ANTI-PATTERN 2: Stashing across diverged branches
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

## Pre-PR Checklist

Before pushing or creating a PR, always reconcile with the target base:

```bash
git fetch origin
git merge origin/staging
# Or: git rebase origin/staging

# Resolve any conflicts locally
npm run ci:check   # verify everything still works
git push
```

This catches conflicts locally where they're easy to resolve, instead of discovering them on the PR page.

## Best Practices

- **Worktree creation**: Always specify base branch — `git worktree add .claude/worktrees/my-task -b fix/my-task origin/staging`
- **Keeping current**: If a worktree lives for hours, run `git fetch origin && git rebase origin/staging` before pushing
- **Cleanup**: After PR merge, remove stale worktrees — `git worktree remove .claude/worktrees/my-task`
- **Recovery**: If you branched from the wrong base, rebase onto the correct one:
  ```bash
  git rebase --onto origin/staging <wrong-base-commit> <your-branch>
  ```
