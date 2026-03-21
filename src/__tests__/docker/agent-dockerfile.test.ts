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

    it("installs git via apt-get", () => {
      expect(content).toMatch(/apt-get.*install[\s\S]*?\bgit\b/);
    });

    it("installs jq via apt-get", () => {
      expect(content).toMatch(/apt-get.*install[\s\S]*?\bjq\b/);
    });

    it("installs GitHub CLI via apt-get", () => {
      expect(content).toMatch(/apt-get.*install.*\bgh\b/);
    });

    it("installs Claude CLI via npm", () => {
      expect(content).toMatch(/npm install.*@anthropic-ai\/claude-code/);
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

    it("does not re-escalate to root after switching to agent user", () => {
      const lines = content.split("\n");
      const userAgentIndex = lines.findIndex((l) => /^USER\s+agent/.test(l));
      expect(userAgentIndex).toBeGreaterThan(-1);
      const laterRootLines = lines
        .slice(userAgentIndex + 1)
        .filter((l) => /^USER\s+root/.test(l));
      expect(laterRootLines).toHaveLength(0);
    });

    it("includes a HEALTHCHECK instruction", () => {
      expect(content).toMatch(/HEALTHCHECK/);
    });

    it("uses agent-entrypoint as entrypoint", () => {
      expect(content).toMatch(/ENTRYPOINT.*agent-entrypoint/);
    });

    it("supports pinnable Claude CLI version via build arg", () => {
      expect(content).toMatch(/ARG\s+CLAUDE_CLI_VERSION/);
    });

    it("does NOT install openssh-client (minimal attack surface)", () => {
      expect(content).not.toMatch(/openssh-client/);
    });

    it("uses ARG not ENV for DEBIAN_FRONTEND", () => {
      expect(content).toMatch(/ARG\s+DEBIAN_FRONTEND/);
      expect(content).not.toMatch(/ENV\s+DEBIAN_FRONTEND/);
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

    it("references env_file for credentials", () => {
      expect(content).toMatch(/env_file/);
      expect(content).toMatch(/\.env\.docker/);
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
  let content: string;

  it("exists", () => {
    expect(existsSync(healthcheckPath)).toBe(true);
  });

  it("is executable", () => {
    expect(() => {
      accessSync(healthcheckPath, constants.X_OK);
    }).not.toThrow();
  });

  beforeAll(() => {
    content = readFileSync(healthcheckPath, "utf-8");
  });

  it("has a bash shebang", () => {
    expect(content.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("checks for the issue-daemon process specifically", () => {
    expect(content).toMatch(/pgrep.*issue-daemon/);
  });

  it("checks the status server health endpoint", () => {
    expect(content).toMatch(/health/);
  });
});

describe("docs/agent-docker.md", () => {
  const docsPath = resolve(ROOT, "docs/agent-docker.md");
  let content: string;

  it("exists", () => {
    expect(existsSync(docsPath)).toBe(true);
  });

  beforeAll(() => {
    content = readFileSync(docsPath, "utf-8");
  });

  it("documents required environment variables", () => {
    expect(content).toMatch(/ANTHROPIC_API_KEY/);
    expect(content).toMatch(/GITHUB_TOKEN/);
  });

  it("documents resource limits", () => {
    expect(content).toMatch(/CPU/i);
    expect(content).toMatch(/memory/i);
  });

  it("documents health check", () => {
    expect(content).toMatch(/[Hh]ealth/);
  });

  it("documents security model", () => {
    expect(content).toMatch(/[Nn]etwork/);
    expect(content).toMatch(/[Nn]on-root/);
  });
});
