import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

/**
 * Tests for Dockerfile.agent and related configuration.
 * Validates file structure, security practices, and configuration without
 * requiring Docker to be running.
 */

const ROOT = resolve(__dirname, "../../../");

describe("Dockerfile.agent", () => {
  const dockerfilePath = resolve(ROOT, "Dockerfile.agent");
  let dockerfile: string;

  beforeAll(() => {
    dockerfile = readFileSync(dockerfilePath, "utf-8");
  });

  it("exists", () => {
    expect(existsSync(dockerfilePath)).toBe(true);
  });

  it("uses Node.js 22 base image", () => {
    expect(dockerfile).toMatch(/^FROM node:22/m);
  });

  it("references git, jq, and gh in apt-get install commands", () => {
    // Verify each tool appears in an install context
    expect(dockerfile).toMatch(/apt-get install[\s\S]*\bgit\b/);
    expect(dockerfile).toMatch(/apt-get install[\s\S]*\bjq\b/);
    expect(dockerfile).toMatch(/apt-get install[\s\S]*\bgh\b/);
  });

  it("installs Claude CLI via npm with a pinned version", () => {
    expect(dockerfile).toMatch(/npm install -g @anthropic-ai\/claude-code/);
    // Should not use @latest — version should be pinned via ARG
    expect(dockerfile).not.toMatch(/claude-code@latest/);
    expect(dockerfile).toMatch(/ARG CLAUDE_CLI_VERSION=/);
  });

  it("does not contain any hardcoded secrets", () => {
    // Should not contain actual API keys, tokens, or passwords
    expect(dockerfile).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(dockerfile).not.toMatch(/ghp_[a-zA-Z0-9]{20,}/);
    expect(dockerfile).not.toMatch(/password\s*=\s*["'][^"']+["']/i);
    // ENV directives should not set secret values
    const envLines = dockerfile
      .split("\n")
      .filter((l) => l.match(/^\s*ENV\s/));
    for (const line of envLines) {
      expect(line).not.toMatch(
        /(ANTHROPIC_API_KEY|GITHUB_TOKEN|DATABASE_URL).*=\s*\S/
      );
    }
  });

  it("creates a non-root user", () => {
    expect(dockerfile).toMatch(/useradd.*agent/);
    expect(dockerfile).toMatch(/^USER agent/m);
  });

  it("includes a HEALTHCHECK directive", () => {
    expect(dockerfile).toMatch(/^HEALTHCHECK/m);
    expect(dockerfile).toContain("healthcheck.sh");
  });

  it("sets WORKDIR to /workdir", () => {
    expect(dockerfile).toMatch(/^WORKDIR \/workdir/m);
  });

  it("references issue-daemon.sh as the default command", () => {
    expect(dockerfile).toContain("issue-daemon.sh");
  });
});

describe("docker-compose.agent.yml", () => {
  const composePath = resolve(ROOT, "docker-compose.agent.yml");
  let compose: string;

  beforeAll(() => {
    compose = readFileSync(composePath, "utf-8");
  });

  it("exists", () => {
    expect(existsSync(composePath)).toBe(true);
  });

  it("configures CPU limits", () => {
    expect(compose).toMatch(/cpus:\s*["']?\d/);
  });

  it("configures memory limits", () => {
    expect(compose).toMatch(/memory:\s*\d+[GMgm]/);
  });

  it("passes secrets via environment variables (not build args)", () => {
    expect(compose).toContain("ANTHROPIC_API_KEY");
    expect(compose).toContain("GITHUB_TOKEN");
    // Should use variable passthrough syntax (no value assigned in file)
    expect(compose).toMatch(/^\s*- ANTHROPIC_API_KEY$/m);
    expect(compose).toMatch(/^\s*- GITHUB_TOKEN$/m);
  });

  it("mounts repo as read-only", () => {
    expect(compose).toMatch(/\.?:\/repo:ro/);
  });

  it("references Dockerfile.agent", () => {
    expect(compose).toContain("Dockerfile.agent");
  });

  it("includes security hardening (no-new-privileges, cap_drop)", () => {
    expect(compose).toMatch(/no-new-privileges/);
    expect(compose).toMatch(/cap_drop/);
  });
});

describe("agent-healthcheck.sh", () => {
  const healthcheckPath = resolve(ROOT, "scripts/agent-healthcheck.sh");
  let healthcheck: string;

  beforeAll(() => {
    healthcheck = readFileSync(healthcheckPath, "utf-8");
  });

  it("exists", () => {
    expect(existsSync(healthcheckPath)).toBe(true);
  });

  it("checks for required binaries via command -v", () => {
    // The script uses `command -v "$cmd"` in a loop over tool names
    expect(healthcheck).toMatch(/command -v/);
    // Verify each required tool is listed in the check
    for (const cmd of ["node", "git", "gh", "jq", "claude"]) {
      expect(healthcheck).toMatch(new RegExp(`\\b${cmd}\\b`));
    }
  });

  it("checks for repo mount at /repo", () => {
    expect(healthcheck).toMatch(/\/repo\b/);
  });

  it("checks workdir is writable at /workdir", () => {
    expect(healthcheck).toMatch(/\/workdir\b/);
  });

  it("uses bash strict mode", () => {
    expect(healthcheck).toContain("set -euo pipefail");
  });

  it("exits 0 for healthy and 1 for unhealthy", () => {
    expect(healthcheck).toContain("exit 0");
    expect(healthcheck).toContain("exit 1");
  });
});

describe("docs/agent-docker.md", () => {
  const docsPath = resolve(ROOT, "docs/agent-docker.md");
  let docs: string;

  beforeAll(() => {
    docs = readFileSync(docsPath, "utf-8");
  });

  it("exists", () => {
    expect(existsSync(docsPath)).toBe(true);
  });

  it("documents required environment variables", () => {
    expect(docs).toContain("ANTHROPIC_API_KEY");
    expect(docs).toContain("GITHUB_TOKEN");
  });

  it("documents resource limits", () => {
    expect(docs).toMatch(/resource/i);
    expect(docs).toMatch(/cpu/i);
    expect(docs).toMatch(/memory/i);
  });

  it("documents health check", () => {
    expect(docs).toMatch(/health/i);
  });
});
