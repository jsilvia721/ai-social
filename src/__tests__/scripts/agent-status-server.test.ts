/**
 * Tests for scripts/agent-status-server.js
 *
 * Spins up the status server on a random port, creates mock state files,
 * and verifies the JSON responses.
 */

import { ChildProcess, spawn } from "child_process";
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

// Use a random port to avoid conflicts in parallel CI
const TEST_PORT = 17420 + Math.floor(Math.random() * 1000);

let serverProcess: ChildProcess;
let tmpDir: string;
let logDir: string;
let stateDir: string;

function request(
  urlPath: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${TEST_PORT}${urlPath}`,
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            reject(new Error(`Failed to parse JSON: ${data}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });
  });
}

function waitForServer(maxWaitMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      if (Date.now() - start > maxWaitMs) {
        reject(new Error("Server did not start in time"));
        return;
      }
      const req = http.get(`http://127.0.0.1:${TEST_PORT}/health`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve());
      });
      req.on("error", () => setTimeout(tryConnect, 100));
      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(tryConnect, 100);
      });
    };
    tryConnect();
  });
}

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-status-test-"));
  logDir = path.join(tmpDir, "logs", "issue-daemon");
  stateDir = path.join(tmpDir, "logs", "daemon-shared");
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const serverScript = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "scripts",
    "agent-status-server.js",
  );
  serverProcess = spawn("node", [serverScript], {
    env: {
      ...process.env,
      AGENT_STATUS_PORT: String(TEST_PORT),
      LOG_DIR: logDir,
      DAEMON_STATE_DIR: stateDir,
      WORKER_PID_FILE: path.join(logDir, ".active_pids"),
    },
    stdio: "pipe",
  });

  await waitForServer();
}, 10000);

afterAll(() => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Clean up state files after each test to prevent pollution on assertion failure
afterEach(() => {
  for (const file of fs.readdirSync(stateDir)) {
    fs.unlinkSync(path.join(stateDir, file));
  }
  for (const file of fs.readdirSync(logDir)) {
    if (
      file.startsWith(".") ||
      file.startsWith("heartbeat") ||
      file.endsWith(".log")
    ) {
      fs.unlinkSync(path.join(logDir, file));
    }
  }
});

describe("GET /status", () => {
  it("returns daemon status with no daemon running", async () => {
    const { status, body } = await request("/status");

    expect(status).toBe(200);
    expect(body).toHaveProperty("timestamp");
    expect(body).toHaveProperty("daemon");
    expect(body).toHaveProperty("mode", "normal");
    expect(body).toHaveProperty("workers");

    const daemon = body.daemon as { pid: number | null; running: boolean };
    expect(daemon.pid).toBeNull();
    expect(daemon.running).toBe(false);

    const workers = body.workers as { active: number; total_tracked: number };
    expect(workers.active).toBe(0);
    expect(workers.total_tracked).toBe(0);
  });

  it("reports rate-limited mode when pause file exists", async () => {
    const futureEpoch = Math.floor(Date.now() / 1000) + 600;
    fs.writeFileSync(path.join(stateDir, "pause-until"), String(futureEpoch));

    const { body } = await request("/status");
    expect(body.mode).toBe("rate-limited");
    expect(body).toHaveProperty("pause_until_epoch", futureEpoch);
    expect(body).toHaveProperty("pause_remaining_seconds");
    expect((body.pause_remaining_seconds as number) > 0).toBe(true);
  });

  it("reports draining mode when drain file exists", async () => {
    fs.writeFileSync(path.join(stateDir, "drain"), "");

    const { body } = await request("/status");
    expect(body.mode).toBe("draining");
  });

  it("reports workers from active_pids file", async () => {
    const pid = process.pid;
    const now = Math.floor(Date.now() / 1000);
    fs.writeFileSync(path.join(logDir, ".active_pids"), `${pid}:42:${now}:worker\n`);
    fs.writeFileSync(path.join(logDir, "heartbeat-42"), String(now));
    fs.writeFileSync(path.join(logDir, "issue-42.log"), "some log output\n");

    const { body } = await request("/status");
    const workers = body.workers as {
      active: number;
      details: Array<{
        pid: number;
        issue: number;
        type: string;
        alive: boolean;
        log_file: string;
        log_size_bytes: number;
        heartbeat: { status: string };
      }>;
    };
    expect(workers.active).toBe(1);
    expect(workers.details).toHaveLength(1);

    const worker = workers.details[0];
    expect(worker.pid).toBe(pid);
    expect(worker.issue).toBe(42);
    expect(worker.type).toBe("worker");
    expect(worker.alive).toBe(true);
    expect(worker.log_file).toBe("issue-42.log");
    expect(worker.log_size_bytes).toBeGreaterThan(0);
    expect(worker.heartbeat.status).toBe("fresh");
  });

  it("reports circuit breaker status", async () => {
    const now = Math.floor(Date.now() / 1000);
    const failures = [now - 10, now - 5, now - 1].join("\n") + "\n";
    fs.writeFileSync(path.join(logDir, ".failure_times"), failures);

    const { body } = await request("/status");
    const cb = body.circuit_breaker as {
      failures_in_window: number;
      tripped: boolean;
    };
    expect(cb.failures_in_window).toBe(3);
    expect(cb.tripped).toBe(true);
  });
});

describe("GET /health", () => {
  it("returns 503 when daemon is not running", async () => {
    const { status, body } = await request("/health");
    expect(status).toBe(503);
    expect(body).toHaveProperty("status", "unhealthy");
  });

  it("returns 200 when daemon PID file exists and process is alive", async () => {
    fs.writeFileSync(
      path.join(logDir, ".issue-daemon.pid"),
      String(process.pid),
    );

    const { status, body } = await request("/health");
    expect(status).toBe(200);
    expect(body).toHaveProperty("status", "healthy");
  });
});

describe("GET /unknown", () => {
  it("returns 404 for unknown routes", async () => {
    const { status, body } = await request("/unknown");
    expect(status).toBe(404);
    expect(body).toHaveProperty("error");
  });
});
