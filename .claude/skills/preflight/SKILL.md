---
name: preflight
description: Pre-push validation ritual — checks branch state, migration drift, CI checks, and workspace hygiene before pushing
disable-model-invocation: true
allowed-tools: Bash(git *), Bash(npm run ci:check), Bash(npx prisma migrate diff *)
---

# Preflight Check

Run all validation steps before pushing a branch. Reports a pass/fail summary.

**Arguments:** $ARGUMENTS — none expected.

## Steps

Run each step sequentially. Track pass/fail for each. Stop on first failure unless noted.

### 1. Branch Freshness

```bash
git fetch origin
```

Check that the current branch contains origin/main:

```bash
git merge-base --is-ancestor origin/main HEAD
```

- **Pass:** Branch is up to date with origin/main.
- **Fail:** Branch is behind origin/main. Report: "Branch is behind origin/main. Run `git merge origin/main` first."

### 2. Migration Drift

Check that `schema.prisma` and migrations are in sync:

```bash
npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --exit-code
```

- **Pass:** No drift detected.
- **Fail:** Schema and migrations are out of sync. Report: "Prisma schema has unapplied changes. Run `npx prisma migrate dev --name <name>`."

### 3. CI Checks

Run the full CI check suite:

```bash
npm run ci:check
```

- **Pass:** Lint, typecheck, and coverage all pass.
- **Fail:** Report the failing step and output.

### 4. Workspace Hygiene

Check for uncommitted changes or stray files:

```bash
git status --short
```

- **Pass:** Working tree is clean (no output).
- **Warn:** List uncommitted files. This is a warning, not a failure — the user may intend to commit them separately.

### 5. Summary

Report a table:

```
Step                | Status
--------------------|--------
Branch freshness    | ✅ Pass
Migration drift     | ✅ Pass
CI checks           | ✅ Pass
Workspace hygiene   | ✅ Clean (or ⚠️ N uncommitted files)
```

If any step failed, report overall **FAIL** with the first failure reason. If all passed, report **READY TO PUSH**.
