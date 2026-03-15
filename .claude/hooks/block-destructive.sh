#!/usr/bin/env bash
# PreToolUse hook: blocks destructive bash commands.
# Receives JSON on stdin with tool_name, tool_input, session_id, cwd.
# Exit 2 = block the action. Exit 0 = allow.
# ALL JSON parsing via jq. Fails open if jq is missing.

set -euo pipefail

# Fail open if jq is not installed
if ! command -v jq &>/dev/null; then
  exit 0
fi

# Read stdin once
INPUT=$(cat)

# Extract the command from tool_input.command using jq
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# If no command found, allow
if [[ -z "$CMD" ]]; then
  exit 0
fi

# Use jq to test all destructive patterns against the command.
# Each pattern is tested with regex inside jq's test() function.
# Returns "block:<reason>" if any match, "allow" otherwise.
RESULT=$(echo "$INPUT" | jq -r '
  .tool_input.command as $cmd |

  # git push --force (but allow --force-with-lease)
  if ($cmd | test("git\\s+push\\s.*--force(?!-with-lease)")) then "block:git push --force is blocked. Use --force-with-lease instead."

  # git push -f (short flag, but allow --force-with-lease)
  elif ($cmd | test("git\\s+push\\s+-[a-zA-Z]*f")) then
    if ($cmd | test("git\\s+push\\s.*--force-with-lease")) then "allow"
    else "block:git push -f is blocked. Use --force-with-lease instead."
    end

  # git reset --hard
  elif ($cmd | test("git\\s+reset\\s+--hard")) then "block:git reset --hard is blocked."

  # git checkout . or git checkout -- .
  elif ($cmd | test("git\\s+checkout\\s+(--\\s+)?\\.($|[\\s;|&])")) then "block:git checkout . is blocked."

  # git restore . or git restore --source
  elif ($cmd | test("git\\s+restore\\s+\\.")) then "block:git restore . is blocked."
  elif ($cmd | test("git\\s+restore\\s+--source")) then "block:git restore --source is blocked."

  # git clean with -f flag
  elif ($cmd | test("git\\s+clean\\s.*-[a-zA-Z]*f")) then "block:git clean -f is blocked."

  # git branch -D (allow -d)
  elif ($cmd | test("git\\s+branch\\s+-D\\s")) then "block:git branch -D is blocked. Use -d instead."

  # rm -rf on critical paths (block /, ., src, prisma, .claude, .github, ~)
  # Allow node_modules, .next, dist, coverage
  elif ($cmd | test("rm\\s+-[a-zA-Z]*r[a-zA-Z]*f|rm\\s+-[a-zA-Z]*f[a-zA-Z]*r")) then
    if ($cmd | test("rm\\s+-rf\\s+(node_modules|\\.next|dist|coverage)")) then "allow"
    elif ($cmd | test("rm\\s+-rf\\s+(/($|\\s)|\\.\\.?($|\\s)|src|prisma|\\.claude|\\.github|~)")) then "block:rm -rf on critical path is blocked."
    else "allow"
    end

  # npx prisma generate without migrate dev
  elif ($cmd | test("npx\\s+prisma\\s+generate")) then
    if ($cmd | test("npx\\s+prisma\\s+migrate\\s+dev")) then "allow"
    else "block:npx prisma generate without migrate dev is blocked. Run npx prisma migrate dev instead."
    end

  else "allow"
  end
')

if [[ "$RESULT" == allow ]]; then
  exit 0
elif [[ "$RESULT" == block:* ]]; then
  REASON="${RESULT#block:}"
  echo "$REASON" >&2
  exit 2
else
  # Unexpected output, fail open
  exit 0
fi
