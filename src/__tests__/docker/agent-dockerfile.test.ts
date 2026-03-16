import { readFileSync, existsSync, accessSync, constants } from "fs";
import { resolve } from "path";

/**
 * Tests for Dockerfile.agent and supporting files.
 *
 * These validate the file structure, content correctness, and security
 * properties without requiring Docker to be running.
 */

const ROOT = resolve(__dirname, "../../..");

describe("Dockerfile.agent", () => {
  const dockerfilePath = resolve(ROOT, "Dockerfile.agent");

  it("exists", () => {
    expect(existsSync(dockerfilePath)).toBe(true);
  });

  describe("content", () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(dockerfilePath, "utf-8");
    });

    it("uses Node.js 22 base image", () => {
      expect(content).toMatch(/FROM node:22/);
    });

    it("installs git", () => {
      expect(content).toMatch(/\bgit\b/);
    });

    it("installs jq", () => {
      expect(content).toMatch(/\bjq\b/);
    });

    it("installs GitHub CLI", () => {
      expect(content).toMatch(/\bgh\b/);
    });

    it("installs Claude CLI", () => {
      expect(content).toMatch(/@anthropic-ai\/claude-code/);
    });

    it("does NOT contain any secrets or API keys", () => {
      expect(content).not.toMatch(/sk-ant-/i);
      expect(content).not.toMatch(/ghp_/i);
      expect(content).not.toMatch(/ANTHROPIC_API_KEY=/);
      expect(content).not.toMatch(/GITHUB_TOKEN=/);
      // ENV declarations for passthrough are OK, but hardcoded values are not
      expect(content).not.toMatch(/ENV\s+ANTHROPIC_API_KEY\s+\S/);
      expect(content).not.toMatch(/ENV\s+GITHUB_TOKEN\s+\S/);
    });

    it("runs as non-root user", () => {
      expect(content).toMatch(/USER\s+agent/);
    });

    it("includes a HEALTHCHECK instruction", () => {
      expect(content).toMatch(/HEALTHCHECK/);
    });

    it("uses the issue-daemon as entrypoint", () => {
      expect(content).toMatch(/issue-daemon/);
    });
  });
});

describe("docker-compose.agent.yml", () => {
  const composePath = resolve(ROOT, "docker-compose.agent.yml");

  it("exists", () => {
    expect(existsSync(composePath)).toBe(true);
  });

  describe("content", () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(composePath, "utf-8");
    });

    it("references Dockerfile.agent", () => {
      expect(content).toMatch(/Dockerfile\.agent/);
    });

    it("configures CPU limits", () => {
      expect(content).toMatch(/cpus:/);
    });

    it("configures memory limits", () => {
      expect(content).toMatch(/memory:/);
    });

    it("passes ANTHROPIC_API_KEY from environment", () => {
      expect(content).toMatch(/ANTHROPIC_API_KEY/);
    });

    it("passes GITHUB_TOKEN from environment", () => {
      expect(content).toMatch(/GITHUB_TOKEN/);
    });

    it("does NOT hardcode any secrets", () => {
      expect(content).not.toMatch(/sk-ant-/i);
      expect(content).not.toMatch(/ghp_[a-zA-Z0-9]/);
    });

    it("mounts repo as read-only", () => {
      expect(content).toMatch(/:ro/);
    });

    it("configures logging limits", () => {
      expect(content).toMatch(/max-size/);
      expect(content).toMatch(/max-file/);
    });
  });
});

describe("scripts/agent-healthcheck.sh", () => {
  const healthcheckPath = resolve(ROOT, "scripts/agent-healthcheck.sh");

  it("exists", () => {
    expect(existsSync(healthcheckPath)).toBe(true);
  });

  it("is executable", () => {
    expect(() => {
      accessSync(healthcheckPath, constants.X_OK);
    }).not.toThrow();
  });

  it("has a bash shebang", () => {
    const content = readFileSync(healthcheckPath, "utf-8");
    expect(content.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("checks for running processes", () => {
    const content = readFileSync(healthcheckPath, "utf-8");
    expect(content).toMatch(/pgrep/);
  });

  it("checks workspace mount", () => {
    const content = readFileSync(healthcheckPath, "utf-8");
    expect(content).toMatch(/\/workspace\/package\.json/);
  });
});

describe("docs/agent-docker.md", () => {
  const docsPath = resolve(ROOT, "docs/agent-docker.md");

  it("exists", () => {
    expect(existsSync(docsPath)).toBe(true);
  });

  it("documents required environment variables", () => {
    const content = readFileSync(docsPath, "utf-8");
    expect(content).toMatch(/ANTHROPIC_API_KEY/);
    expect(content).toMatch(/GITHUB_TOKEN/);
  });

  it("documents resource limits", () => {
    const content = readFileSync(docsPath, "utf-8");
    expect(content).toMatch(/CPU/i);
    expect(content).toMatch(/memory/i);
  });

  it("documents health check", () => {
    const content = readFileSync(docsPath, "utf-8");
    expect(content).toMatch(/[Hh]ealth/);
  });
});
