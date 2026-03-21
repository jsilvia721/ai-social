# Agent Docker Setup

Run the autonomous issue-daemon agent in a Docker container with resource limits, credential isolation, and a status endpoint.

## Prerequisites

- Docker and Docker Compose v2
- `ANTHROPIC_API_KEY` — Claude API key
- `GITHUB_TOKEN` — GitHub personal access token with `repo` scope
- `~/.claude` — Claude CLI auth directory (mounted read-only)

## Quick Start

```bash
# 1. Copy and fill in credentials
cp .env.docker.example .env.docker
# Edit .env.docker with your ANTHROPIC_API_KEY and GITHUB_TOKEN

# 2. Build and run
docker compose -f docker-compose.agent.yml up --build

# 3. Check status
curl http://localhost:7420/status | jq .

# Run detached
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
├── ~/.claude (mounted read-only for CLI auth)
└── Docker container (ai-social-agent)
    ├── /workspace (ro)             ← mounted repo
    ├── /agent-workdir/repo         ← writable clone (created by entrypoint)
    ├── /agent-workdir/logs         ← daemon logs
    └── :7420                       ← HTTP status endpoint
```

The repo is mounted **read-only**. On startup, the entrypoint script (`agent-entrypoint.sh`) clones the repo into `/agent-workdir/repo` — a writable location that supports git worktree operations. The daemon runs from the clone and pushes to GitHub via the `GITHUB_TOKEN`.

### Startup Flow

1. **Validate** — Check required env vars (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`)
2. **Clone** — `git clone --reference /workspace` into writable volume (fast, uses local objects)
3. **Configure** — Set git user, remote URL, gh auth
4. **Install** — `npm ci` for dependencies
5. **Status server** — Start HTTP status endpoint in background
6. **Daemon** — `exec` the issue-daemon with CLI args

## Credentials

All secrets live in `.env.docker` (gitignored). Never baked into the image.

```bash
cp .env.docker.example .env.docker
```

| Credential | Where it goes | How it's protected |
|-----------|---------------|-------------------|
| `ANTHROPIC_API_KEY` | `.env.docker` → container env | Runtime-only, gitignored file |
| `GITHUB_TOKEN` | `.env.docker` → container env | Runtime-only, gitignored file |
| Claude CLI auth | `~/.claude` → `/home/agent/.claude` | Read-only volume mount |

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
| `AGENT_STATUS_PORT` | No | `7420` | HTTP status endpoint port |
| `CLAUDE_CONFIG_DIR` | No | `~/.claude` | Host path to Claude CLI config |

### Resource Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_CPU_LIMIT` | `2.0` | CPU cores limit |
| `AGENT_MEMORY_LIMIT` | `4G` | Memory limit |

Override via `.env.docker` or environment:

```bash
AGENT_CPU_LIMIT=4.0 AGENT_MEMORY_LIMIT=8G \
  docker compose -f docker-compose.agent.yml up --build
```

Tmpfs disk is capped at 256MB for `/tmp`.

## Status Endpoint

The container runs a lightweight HTTP status server on port 7420.

### `GET /status`

Returns full daemon status as JSON:

```json
{
  "timestamp": "2026-03-20T12:00:00.000Z",
  "daemon": { "pid": 42, "running": true, "uptime_seconds": 3600 },
  "mode": "normal",
  "workers": {
    "active": 1,
    "total_tracked": 1,
    "details": [{
      "pid": 123, "issue": 42, "type": "worker",
      "alive": true, "elapsed_seconds": 600,
      "heartbeat": { "status": "fresh", "age_seconds": 15 },
      "log_file": "issue-42.log", "log_size_bytes": 1024
    }]
  },
  "circuit_breaker": { "failures_in_window": 0, "tripped": false }
}
```

### `GET /health`

Simple health check — returns `200` if daemon is running, `503` if not.

## Health Check

The container includes a Docker HEALTHCHECK that runs every 30 seconds:

1. Queries the status endpoint (`/health`)
2. Falls back to process checks during startup

Check health status:

```bash
docker inspect --format='{{.State.Health.Status}}' ai-social-agent
```

## Security

- **No secrets in the image** — all credentials are passed via `.env.docker` at runtime.
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
- Missing `ANTHROPIC_API_KEY` or `GITHUB_TOKEN` in `.env.docker`
- Repo not mounted (run from repo root)

### Health check failing

```bash
# Run the health check manually
docker exec ai-social-agent /usr/local/bin/agent-healthcheck

# Check the status endpoint directly
curl http://localhost:7420/status | jq .
```

### Worktree disk usage growing

The agent worktrees persist in the `agent-workdir` Docker volume. To clean up:

```bash
# Remove the volume (stops container first)
docker compose -f docker-compose.agent.yml down -v
```
