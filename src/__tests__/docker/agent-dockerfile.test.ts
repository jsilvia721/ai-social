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

  it("installs required tools: git, jq, gh CLI", () => {
    expect(dockerfile).toContain("git");
    expect(dockerfile).toContain("jq");
    // gh CLI installed via GitHub's apt repository
    expect(dockerfile).toContain("apt-get install");
    expect(dockerfile).toContain("gh");
  });

  it("installs Claude CLI via npm", () => {
    expect(dockerfile).toMatch(/npm install -g @anthropic-ai\/claude-code/);
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
        /ANTHROPIC_API_KEY|GITHUB_TOKEN|DATABASE_URL.*=\s*\S/
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

  it("checks for required binaries", () => {
    for (const cmd of ["node", "git", "gh", "jq", "claude"]) {
      expect(healthcheck).toContain(cmd);
    }
  });

  it("checks for repo mount", () => {
    expect(healthcheck).toContain("/repo");
  });

  it("checks workdir is writable", () => {
    expect(healthcheck).toContain("/workdir");
  });

  it("uses bash strict mode", () => {
    expect(healthcheck).toContain("set -euo pipefail");
  });

  it("exits with appropriate codes", () => {
    expect(healthcheck).toContain("exit 0");
    expect(healthcheck).toContain("exit 1");
  });
});

describe("docs/agent-docker.md", () => {
  const docsPath = resolve(ROOT, "docs/agent-docker.md");

  it("exists", () => {
    expect(existsSync(docsPath)).toBe(true);
  });

  it("documents required environment variables", () => {
    const docs = readFileSync(docsPath, "utf-8");
    expect(docs).toContain("ANTHROPIC_API_KEY");
    expect(docs).toContain("GITHUB_TOKEN");
  });

  it("documents resource limits", () => {
    const docs = readFileSync(docsPath, "utf-8");
    expect(docs).toMatch(/resource/i);
    expect(docs).toMatch(/cpu/i);
    expect(docs).toMatch(/memory/i);
  });

  it("documents health check", () => {
    const docs = readFileSync(docsPath, "utf-8");
    expect(docs).toMatch(/health/i);
  });
});
