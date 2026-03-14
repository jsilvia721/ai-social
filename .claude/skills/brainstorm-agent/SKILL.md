---
name: brainstorm-agent
description: Manually trigger the brainstorm agent Lambda to generate or iterate on product roadmap ideas
allowed-tools: Bash, Read, Grep, Glob
---

# Brainstorm Agent Trigger

Manually invoke the brainstorm agent Lambda that assesses the current application state and generates product roadmap ideas as a GitHub issue.

**Arguments:** $ARGUMENTS — optional flags:
- `--force` — delete any OPEN BrainstormSession records first, bypassing cooldown to force a fresh generation
- `--logs` — just show recent Lambda logs without invoking
- `--status` — show current BrainstormSession state from the database

## How It Works

The brainstorm agent (`src/cron/brainstorm.ts`) runs on a 60-minute cron. It:
1. **Generates** — Gathers open issues, recent PRs, and `docs/brainstorm-context.md`, then calls Claude to produce 5-7 roadmap ideas as a GitHub issue with checkboxes
2. **Iterates** — On subsequent runs, processes human comments on the issue and refines ideas via Claude
3. **Promotes** — When you check off items on the issue, creates Plan issues from them

## Execution Steps

### 1. Determine action from arguments

- If `--logs`: tail the Lambda logs and stop
- If `--status`: query the DB and stop
- If `--force`: delete OPEN sessions first, then invoke

### 2. Get infrastructure details

```bash
# Lambda function — find the current function name
FUNCTION_NAME=$(aws lambda list-functions --query "Functions[?contains(FunctionName, 'BrainstormAgent')].FunctionName" --output text 2>/dev/null)

# Log group
LOG_GROUP=$(aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/ai-social-production-BrainstormAgent" --query "logGroups[0].logGroupName" --output text 2>/dev/null)

# Database URL
DB_URL=$(npx sst secret list --stage production 2>/dev/null | grep DatabaseUrl | cut -d= -f2-)
```

### 3. If `--status`, query and display

```bash
psql "$DB_URL" -c 'SELECT id, "githubIssueNumber", status, "itemCount", "approvedCount", "closedAt", "createdAt" FROM "BrainstormSession" ORDER BY "createdAt" DESC LIMIT 5;'
```

Display results and stop.

### 4. If `--logs`, tail and display

```bash
aws logs tail "$LOG_GROUP" --since 1h --format short | tail -30
```

Display results and stop.

### 5. If `--force`, clear stale sessions

```bash
psql "$DB_URL" -c "UPDATE \"BrainstormSession\" SET status = 'CLOSED', \"closedAt\" = NOW() WHERE status = 'OPEN';"
```

### 6. Invoke the Lambda

```bash
aws lambda invoke --function-name "$FUNCTION_NAME" --payload '{}' --cli-read-timeout 300 /dev/stdout
```

Use a 5-minute timeout since the Lambda calls Claude and GitHub.

### 7. Check results

Wait 30 seconds, then tail the logs to see if it succeeded:

```bash
aws logs tail "$LOG_GROUP" --since 5m --format short | tail -20
```

Also check for new brainstorm issues:

```bash
gh issue list --repo jsilvia721/ai-social --search "Brainstorm: Week of" --limit 3
```

### 8. Report outcome

Tell the user:
- Whether a new brainstorm issue was created (with link)
- If it hit cooldown (and when the next one will generate)
- If there was an error (with the error message from logs)
