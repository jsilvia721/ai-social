# Agent Docker Setup

Run the autonomous issue-daemon agent in a Docker container with resource isolation and no baked-in secrets.

## Quick Start

```bash
# Build the image
docker build -f Dockerfile.agent -t ai-social-agent .

# Run with docker-compose (recommended)
ANTHROPIC_API_KEY=sk-... GITHUB_TOKEN=ghp_... \
  docker compose -f docker-compose.agent.yml up --build

# Or run directly
docker run --rm \
  -v "$(pwd):/repo:ro" \
  -e ANTHROPIC_API_KEY \
  -e GITHUB_TOKEN \
  --cpus 2 --memory 4g \
  ai-social-agent
```

## Architecture

```
Host filesystem (read-only mount)
  /repo ──────────────────────── Source code, scripts, configs
  /workdir ───────────────────── Writable volume for agent worktrees
  /tmp ───────────────────────── tmpfs scratch space (1 GB cap)
```

The container runs as a non-root `agent` user (UID 1000). The repo is mounted read-only at `/repo`. The agent creates git worktrees under `/workdir` for isolated work on each issue.

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Claude API key for Claude CLI |
| `GITHUB_TOKEN` | GitHub token with `repo` and `issues` scope |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `AGENT_MAX_WORKERS` | `1` | Max parallel worker instances |
| `AGENT_POLL_INTERVAL` | `60` | Seconds between issue polls |
| `AGENT_MAX_BUDGET` | `50` | Max USD budget per issue |

## Resource Limits

Default limits in `docker-compose.agent.yml`:

| Resource | Limit | Reservation |
|----------|-------|-------------|
| CPU | 2 cores | 0.5 cores |
| Memory | 4 GB | 512 MB |
| Disk (tmpfs) | 1 GB | — |

Override via environment or by editing the compose file:

```bash
# Override CPU and memory at runtime
docker run --rm \
  --cpus 4 --memory 8g \
  -v "$(pwd):/repo:ro" \
  -e ANTHROPIC_API_KEY -e GITHUB_TOKEN \
  ai-social-agent
```

## Health Check

The container includes a health check (`scripts/agent-healthcheck.sh`) that verifies:

- Essential tools installed: `node`, `git`, `gh`, `jq`, `claude`
- Node.js version is 22+
- Repo is mounted at `/repo`
- `/workdir` is writable

Check health status:

```bash
docker inspect --format='{{.State.Health.Status}}' ai-social-agent
```

## Development

### Build the image

```bash
docker build -f Dockerfile.agent -t ai-social-agent .
```

### Run a one-off command

```bash
docker run --rm -it \
  -v "$(pwd):/repo:ro" \
  -e ANTHROPIC_API_KEY -e GITHUB_TOKEN \
  ai-social-agent -c "gh issue list --label claude-ready"
```

### View logs

```bash
docker compose -f docker-compose.agent.yml logs -f agent
```

### Stop the agent

```bash
docker compose -f docker-compose.agent.yml down
```

## Security

- Secrets are passed via environment variables at runtime, never baked into the image
- The repo is mounted read-only; agent writes go to a separate volume
- The container runs as non-root user `agent` (UID 1000)
- Resource limits prevent runaway CPU/memory usage
- tmpfs mount caps scratch disk usage
