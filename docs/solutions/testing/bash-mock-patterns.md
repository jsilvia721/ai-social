---
title: "Bash Test Mocking Patterns for Daemon Libraries"
date: "2026-03-15"
category: "testing"
severity: "medium"
component: "scripts/__tests__/, scripts/lib/"
symptoms:
  - "Mock function silently exits under set -u with no error message"
  - "Mock function not visible inside command substitution subshell"
  - "gh --jq flag not processable by mock function"
tags:
  - bash
  - testing
  - mocking
  - set-u
  - export-f
  - daemon
  - gh-cli
related_issues:
  - "#568"
  - "#575"
---

## Problem

Bash test mocking for daemon libraries (`scripts/lib/`) has three non-obvious pitfalls that cause silent failures or incorrect test behavior.

## Root Cause

1. **`set -u` kills mock functions silently** — bash's `set -u` (nounset) causes immediate exit when a mock function references an unset positional parameter. No error message is printed, making the failure invisible.
2. **Subshell scoping** — functions defined in the current shell are not visible inside `$(...)` command substitution subshells unless explicitly exported.
3. **`gh --jq` is a single CLI invocation** — mock functions receive CLI flags as arguments but cannot replicate `gh`'s built-in `--jq` processing.

## Investigation Steps

These patterns were discovered while adding tests for `scripts/lib/conflict-resolver.sh` in issue #568. Each caused test failures that were difficult to diagnose due to silent exits or missing output.

## Fix

### Pattern 1: Use `$*` instead of positional parameters in mocks

Under `set -euo pipefail`, referencing `$6` when only 5 arguments are passed causes the script to exit immediately with no error output.

**Before (breaks silently):**
```bash
gh() {
  local subcommand="$1"
  local resource="$2"
  local action="$3"
  local flag1="$4"
  local flag2="$5"
  local flag3="$6"  # exits here if only 5 args passed — no error message
  # ...
}
```

**After (works reliably):**
```bash
gh() {
  case "$*" in
    *"pr list"*)
      echo '[]'
      ;;
    *"pr comment"*)
      echo "mock: commented on PR" >> "$TEST_DIR/gh-calls.log"
      ;;
    *)
      echo "mock: gh $*" >> "$TEST_DIR/gh-calls.log"
      ;;
  esac
}
```

Use `$*` to capture all arguments as a single string and pattern-match with `case`. This avoids referencing specific positional parameters that may not exist.

### Pattern 2: `export -f` is only needed for subshell calls

When a library function is `source`d into the test shell and calls your mock directly, the mock is visible without `export -f`. But if the library uses command substitution (`$(...)`), that creates a subshell where the mock is not visible.

**Direct call (no export needed):**
```bash
# Library does: gh pr edit ...
# Mock is visible because it's in the same shell
gh() {
  echo "mock: gh $*" >> "$TEST_DIR/gh-calls.log"
}

source "$REPO_ROOT/scripts/lib/my-library.sh"
my_library_function  # calls gh directly — mock works
```

**Subshell call (export -f required):**
```bash
# Library does: result=$(gh pr list ...)
# The $(...) creates a subshell where the mock is invisible
gh() {
  case "$*" in
    *"pr list"*) echo '["pr-1"]' ;;
  esac
}
export -f gh  # required — makes mock visible in subshells

source "$REPO_ROOT/scripts/lib/my-library.sh"
my_library_function  # calls $(gh ...) — mock works because of export -f
```

**When to clean up:** After tests that use `export -f`, unexport the function to avoid leaking into subsequent tests:
```bash
unset -f gh
```

### Pattern 3: Use `gh ... | jq` instead of `gh --jq`

The `--jq` flag is processed internally by the real `gh` CLI. A mock function receives `--jq` as just another string argument and cannot replicate this behavior.

**Before (untestable):**
```bash
# In library code:
label=$(gh pr view "$pr" --json labels --jq '.labels[].name' 2>/dev/null)
```

**After (testable):**
```bash
# In library code:
label=$(gh pr view "$pr" --json labels 2>/dev/null | jq -r '.labels[].name')
```

With the piped version, the mock `gh` function returns raw JSON, and the real `jq` processes it. This makes the library fully testable without needing to mock `jq`'s behavior inside `gh`.

## Prevention

- When writing new bash library functions in `scripts/lib/`, always use `gh ... | jq` instead of `gh --jq` for testability.
- When writing mock functions in test files, use `case "$*"` pattern matching instead of positional parameter destructuring.
- Only add `export -f` when the mock needs to be visible inside `$(...)` subshells; document why with a comment.

## Examples

See these test files for working implementations of these patterns:
- `scripts/__tests__/conflict-resolver.test.sh` — demonstrates all three patterns
- `scripts/__tests__/daemon-state.test.sh` — demonstrates basic sourcing and mock setup
