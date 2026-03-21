#!/usr/bin/env node
/**
 * agent-status-server.js — Lightweight HTTP status endpoint for the agent container.
 *
 * Reads daemon state files and exposes them as JSON over HTTP.
 *
 * Endpoints:
 *   GET /status  — Full daemon status (JSON)
 *   GET /health  — Simple health check (200 OK or 503)
 *
 * Environment:
 *   AGENT_STATUS_PORT  — Port to listen on (default: 7420)
 *   LOG_DIR            — Daemon log directory (default: ./logs/issue-daemon)
 *   DAEMON_STATE_DIR   — Shared state directory (default: ./logs/daemon-shared)
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.AGENT_STATUS_PORT || "7420", 10);
const LOG_DIR = process.env.LOG_DIR || "./logs/issue-daemon";
const STATE_DIR = process.env.DAEMON_STATE_DIR || "./logs/daemon-shared";
const PID_FILE = path.join(LOG_DIR, ".issue-daemon.pid");
const ACTIVE_PIDS_FILE =
  process.env.WORKER_PID_FILE || path.join(LOG_DIR, ".active_pids");

/**
 * Read a file's contents, returning null if it doesn't exist.
 */
function readFileOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
}

/**
 * Check if a process is alive by sending signal 0.
 * EPERM means the process exists but we lack permission to signal it — still alive.
 * ESRCH means the process does not exist.
 * Note: PID recycling can cause false positives, but this is acceptable for
 * short-lived containers where PIDs are unlikely to wrap.
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === "EPERM") {
      return true; // Process exists, we just can't signal it
    }
    return false;
  }
}

/**
 * Get daemon PID and running status.
 */
function getDaemonInfo() {
  const pidStr = readFileOrNull(PID_FILE);
  if (!pidStr) return { pid: null, running: false };

  const pid = parseInt(pidStr, 10);
  if (isNaN(pid)) return { pid: null, running: false };

  return { pid, running: isProcessAlive(pid) };
}

/**
 * Get the current daemon mode: normal, draining, or rate-limited.
 */
function getMode() {
  const drainFile = path.join(STATE_DIR, "drain");
  if (fs.existsSync(drainFile)) {
    return { mode: "draining" };
  }

  const pauseFile = path.join(STATE_DIR, "pause-until");
  const pauseStr = readFileOrNull(pauseFile);
  if (pauseStr) {
    const pauseEpoch = parseInt(pauseStr, 10);
    const now = Math.floor(Date.now() / 1000);
    if (pauseEpoch > now) {
      return {
        mode: "rate-limited",
        pause_until_epoch: pauseEpoch,
        pause_until: new Date(pauseEpoch * 1000).toISOString(),
        pause_remaining_seconds: pauseEpoch - now,
      };
    }
  }

  return { mode: "normal" };
}

/**
 * Parse active workers from the PID metadata file.
 */
function getWorkers() {
  const content = readFileOrNull(ACTIVE_PIDS_FILE);
  if (!content) return [];

  const now = Math.floor(Date.now() / 1000);
  const workers = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    const parts = line.split(":");
    if (parts.length < 4) continue;

    const [pidStr, issueStr, startStr, type] = parts;
    const pid = parseInt(pidStr, 10);
    const issue = parseInt(issueStr, 10);
    const startEpoch = parseInt(startStr, 10);

    if (isNaN(pid) || isNaN(issue) || isNaN(startEpoch)) continue;

    const alive = isProcessAlive(pid);
    const elapsedSeconds = now - startEpoch;
    const heartbeat = getHeartbeat(issue);

    // Determine log file
    let logName;
    switch (type) {
      case "plan":
        logName = `plan-${issue}.log`;
        break;
      case "plan-writer":
        logName = `plan-writer-${issue}.log`;
        break;
      case "bug-investigate":
        logName = `bug-investigate-${issue}.log`;
        break;
      case "conflict-resolver":
        logName = `conflict-pr-${issue}.log`;
        break;
      default:
        logName = `issue-${issue}.log`;
    }

    const logPath = path.join(LOG_DIR, logName);
    let logSizeBytes = 0;
    try {
      logSizeBytes = fs.statSync(logPath).size;
    } catch {
      // file doesn't exist
    }

    workers.push({
      pid,
      issue,
      type,
      alive,
      start_epoch: startEpoch,
      elapsed_seconds: elapsedSeconds,
      heartbeat,
      log_file: logName,
      log_size_bytes: logSizeBytes,
    });
  }

  return workers;
}

/**
 * Get heartbeat info for a worker issue.
 */
function getHeartbeat(issue) {
  const hbFile = path.join(LOG_DIR, `heartbeat-${issue}`);
  const hbStr = readFileOrNull(hbFile);

  if (!hbStr) {
    return { status: "missing", age_seconds: null };
  }

  const hbEpoch = parseInt(hbStr, 10);
  if (isNaN(hbEpoch)) {
    return { status: "invalid", age_seconds: null };
  }

  const now = Math.floor(Date.now() / 1000);
  const age = now - hbEpoch;

  let status;
  if (age < 60) status = "fresh";
  else if (age < 300) status = "warm";
  else status = "stale";

  return { status, age_seconds: age, last_epoch: hbEpoch };
}

/**
 * Get circuit breaker status.
 */
function getCircuitBreaker() {
  const failureFile = path.join(LOG_DIR, ".failure_times");
  const content = readFileOrNull(failureFile);
  if (!content) return { failures_in_window: 0, tripped: false };

  const now = Math.floor(Date.now() / 1000);
  const window = 60; // seconds
  const threshold = 3;

  const failures = content
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => parseInt(l, 10))
    .filter((t) => !isNaN(t) && now - t < window);

  return {
    failures_in_window: failures.length,
    tripped: failures.length >= threshold,
    window_seconds: window,
    threshold,
  };
}

/**
 * Build the full status response.
 */
function buildStatus() {
  const daemon = getDaemonInfo();
  const modeInfo = getMode();
  const workers = getWorkers();
  const circuitBreaker = getCircuitBreaker();

  const uptime = daemon.running ? getUptimeSeconds(daemon.pid) : null;

  return {
    timestamp: new Date().toISOString(),
    daemon: {
      ...daemon,
      uptime_seconds: uptime,
    },
    ...modeInfo,
    workers: {
      active: workers.filter((w) => w.alive).length,
      total_tracked: workers.length,
      details: workers,
    },
    circuit_breaker: circuitBreaker,
  };
}

/**
 * Estimate daemon uptime from PID file mtime.
 */
function getUptimeSeconds(pid) {
  if (!pid) return null;
  try {
    const stat = fs.statSync(PID_FILE);
    return Math.floor((Date.now() - stat.mtimeMs) / 1000);
  } catch {
    return null;
  }
}

// --- HTTP Server -------------------------------------------------------------

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  if (req.method === "GET" && req.url === "/status") {
    const status = buildStatus();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status, null, 2));
  } else if (req.method === "GET" && req.url === "/health") {
    const daemon = getDaemonInfo();
    if (daemon.running) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "healthy" }));
    } else {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "unhealthy", reason: "daemon not running" }));
    }
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Use GET /status or GET /health" }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[status-server] Listening on 127.0.0.1:${PORT}`);
});

// Graceful shutdown with forced exit timeout
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
