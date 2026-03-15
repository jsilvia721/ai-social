#!/usr/bin/env bash
# migrate-labels.sh — Create needs-human-review label and migrate old labels
# Idempotent: safe to re-run multiple times.
set -euo pipefail

REPO="${GITHUB_REPOSITORY:-jsilvia721/ai-social}"
NEW_LABEL="needs-human-review"
OLD_LABELS=("claude-plan-review" "needs-triage" "claude-self-improvement")

# 1. Create the new label (idempotent — skips if it already exists)
if gh label list --repo "$REPO" --search "$NEW_LABEL" --json name -q '.[].name' | grep -qx "$NEW_LABEL"; then
  echo "✓ Label '$NEW_LABEL' already exists"
else
  gh label create "$NEW_LABEL" --repo "$REPO" --color "D93F0B" --description "Requires human review before proceeding"
  echo "✓ Created label '$NEW_LABEL'"
fi

# 2. For each old label, find open issues and add the new label
migrated=0
for old_label in "${OLD_LABELS[@]}"; do
  issues=$(gh issue list --repo "$REPO" --label "$old_label" --state open --json number -q '.[].number')
  if [ -z "$issues" ]; then
    echo "— No open issues with label '$old_label'"
    continue
  fi
  for issue_num in $issues; do
    # Check if the issue already has the new label (idempotent)
    has_label=$(gh issue view "$issue_num" --repo "$REPO" --json labels -q ".labels[].name" | grep -cx "$NEW_LABEL" || true)
    if [ "$has_label" -gt 0 ]; then
      echo "— Issue #$issue_num already has '$NEW_LABEL' (from '$old_label')"
    else
      gh issue edit "$issue_num" --repo "$REPO" --add-label "$NEW_LABEL"
      echo "✓ Issue #$issue_num: added '$NEW_LABEL' (had '$old_label')"
      ((migrated++))
    fi
  done
done

echo ""
echo "Done. Migrated $migrated issue(s). Old labels preserved for transition."
