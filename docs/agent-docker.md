# Agent Docker Setup

Run the autonomous issue-daemon agent in a Docker container with resource limits, volume mounts, and health checks.

## Prerequisites

- Docker and Docker Compose v2
- `ANTHROPIC_API_KEY` — Claude API key
- `GITHUB_TOKEN` — GitHub personal access token with `repo` scope
- `DATABASE_URL` — (optional) database connection string

## Quick Start

```bash
# Build the image
docker build -f Dockerfile.agent -t ai-social-agent .

# Build with pinned Claude CLI version (recommended for production)
docker build -f Dockerfile.agent --build-arg CLAUDE_CLI_VERSION=1.0.0 -t ai-social-agent .

# Run with docker-compose (recommended)
ANTHROPIC_API_KEY=sk-... GITHUB_TOKEN=ghp_... \
  docker compose -f docker-compose.agent.yml up --build

# Run detached
ANTHROPIC_API_KEY=sk-... GITHUB_TOKEN=ghp_... \
  docker compose -f docker-compose.agent.yml up -d --build

# View logs
docker compose -f docker-compose.agent.yml logs -f agent

# Stop
docker compose -f docker-compose.agent.yml down
```

## Architecture

```
Host machine
├── Repo (mounted read-only at /workspace)
└── Docker container (ai-social-agent)
    ├── /workspace (ro)          ← mounted repo
    ├── /agent-workdir/worktrees ← writable git worktrees
    └── /agent-workdir/logs      ← daemon logs
```

The repo is mounted **read-only**. The agent creates git worktrees in `/agent-workdir/worktrees` for each issue it works on. This prevents the agent from accidentally modifying the host repo.

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | — | Claude API key |
| `GITHUB_TOKEN` | Yes | — | GitHub PAT with repo scope |
| `DATABASE_URL` | No | — | Database connection string |
| `AGENT_MAX_WORKERS` | No | `1` | Max parallel agent workers |
| `AGENT_POLL_INTERVAL` | No | `60` | Seconds between issue polls |
| `AGENT_MAX_BUDGET` | No | `50` | Max USD budget per issue |

### Resource Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_CPU_LIMIT` | `2.0` | CPU cores limit |
| `AGENT_MEMORY_LIMIT` | `4G` | Memory limit |

Override via environment:

```bash
AGENT_CPU_LIMIT=4.0 AGENT_MEMORY_LIMIT=8G \
  docker compose -f docker-compose.agent.yml up --build
```

Tmpfs disk is capped at 256MB for `/tmp`.

## Health Check

The container includes a health check that runs every 30 seconds and verifies:

1. An agent process (issue-daemon, node, or claude) is running
2. Node.js is available
3. `gh` CLI is authenticated (if `GITHUB_TOKEN` is set)
4. The workspace volume is mounted

Check health status:

```bash
docker inspect --format='{{.State.Health.Status}}' ai-social-agent
```

## Security

- **No secrets in the image** — all credentials are passed via environment variables at runtime.
- **Non-root user** — the container runs as `agent` (UID 1000), not root.
- **Read-only repo mount** — the host repo cannot be modified by the agent.
- **Resource limits** — CPU, memory, and disk are capped to prevent runaway processes.
- **Log rotation** — container logs are limited to 150MB (3 x 50MB files).
- **Network access** — the container has outbound network access by design (it needs GitHub API and Anthropic API). No egress filtering is applied. If running in a sensitive environment, consider adding a network policy or egress proxy.
- **Pinnable dependencies** — the Dockerfile supports a `CLAUDE_CLI_VERSION` build arg for supply-chain safety. Pin base image to a digest for production use (see comments in Dockerfile).

## Troubleshooting

### Container exits immediately

Check the logs: `docker compose -f docker-compose.agent.yml logs agent`

Common causes:
- Missing `ANTHROPIC_API_KEY` or `GITHUB_TOKEN`
- Repo not mounted (run from repo root)

### Health check failing

```bash
# Run the health check manually
docker exec ai-social-agent /usr/local/bin/agent-healthcheck
```

### Worktree disk usage growing

The agent worktrees persist in the `agent-workdir` Docker volume. To clean up:

```bash
# Remove the volume (stops container first)
docker compose -f docker-compose.agent.yml down -v
```
