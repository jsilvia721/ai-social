/**
 * Unit tests for QA/UX audit script — config, schemas, helpers.
 *
 * Tests cover: Zod schema validation, issue body generation,
 * fingerprint generation, label assignment, slug sanitization.
 */

import {
  FindingSchema,
  FindingsResponseSchema,
  generateFingerprint,
  getLabelsForFinding,
  sanitizeSlug,
  buildIssueBody,
  buildUserPrompt,
  ROUTE_MANIFEST,
  VIEWPORTS,
  SYSTEM_PROMPT,
  type Finding,
  type IssueBodyParams,
} from "../../../scripts/lib/qa-audit/config";

// ── FindingSchema Validation ────────────────────────────────────────────────

describe("FindingSchema", () => {
  const validFinding: Finding = {
    title: "Button text truncated on mobile",
    description: "The submit button text is cut off at 375px viewport width.",
    severity: "major",
    confidence: 0.85,
    complexity: "simple",
    viewport: "mobile",
  };

  it("accepts a valid finding", () => {
    const result = FindingSchema.parse(validFinding);
    expect(result).toEqual(validFinding);
  });

  it("accepts a finding with optional element field", () => {
    const result = FindingSchema.parse({
      ...validFinding,
      element: ".submit-btn",
    });
    expect(result.element).toBe(".submit-btn");
  });

  it("rejects finding with empty title", () => {
    expect(() =>
      FindingSchema.parse({ ...validFinding, title: "" })
    ).toThrow();
  });

  it("rejects finding with empty description", () => {
    expect(() =>
      FindingSchema.parse({ ...validFinding, description: "" })
    ).toThrow();
  });

  it("rejects finding with invalid severity", () => {
    expect(() =>
      FindingSchema.parse({ ...validFinding, severity: "low" })
    ).toThrow();
  });

  it("rejects confidence below 0", () => {
    expect(() =>
      FindingSchema.parse({ ...validFinding, confidence: -0.1 })
    ).toThrow();
  });

  it("rejects confidence above 1", () => {
    expect(() =>
      FindingSchema.parse({ ...validFinding, confidence: 1.1 })
    ).toThrow();
  });

  it("rejects invalid complexity", () => {
    expect(() =>
      FindingSchema.parse({ ...validFinding, complexity: "medium" })
    ).toThrow();
  });

  it("rejects invalid viewport", () => {
    expect(() =>
      FindingSchema.parse({ ...validFinding, viewport: "tablet" })
    ).toThrow();
  });
});

// ── FindingsResponseSchema Validation ───────────────────────────────────────

describe("FindingsResponseSchema", () => {
  it("accepts a valid response", () => {
    const result = FindingsResponseSchema.parse({
      findings: [
        {
          title: "Test finding",
          description: "Test description",
          severity: "minor",
          confidence: 0.9,
          complexity: "simple",
          viewport: "desktop",
        },
      ],
      overallScore: 85,
      summary: "Page looks good overall.",
    });
    expect(result.findings).toHaveLength(1);
    expect(result.overallScore).toBe(85);
  });

  it("accepts empty findings array", () => {
    const result = FindingsResponseSchema.parse({
      findings: [],
      overallScore: 100,
      summary: "No issues found.",
    });
    expect(result.findings).toHaveLength(0);
  });

  it("rejects overallScore above 100", () => {
    expect(() =>
      FindingsResponseSchema.parse({
        findings: [],
        overallScore: 101,
        summary: "test",
      })
    ).toThrow();
  });

  it("rejects overallScore below 0", () => {
    expect(() =>
      FindingsResponseSchema.parse({
        findings: [],
        overallScore: -1,
        summary: "test",
      })
    ).toThrow();
  });
});

// ── Fingerprint Generation ──────────────────────────────────────────────────

describe("generateFingerprint", () => {
  it("returns a deterministic fingerprint for same inputs", () => {
    const fp1 = generateFingerprint("/dashboard", "Button truncated");
    const fp2 = generateFingerprint("/dashboard", "Button truncated");
    expect(fp1).toBe(fp2);
  });

  it("returns different fingerprints for different routes", () => {
    const fp1 = generateFingerprint("/dashboard", "Button truncated");
    const fp2 = generateFingerprint("/dashboard/posts", "Button truncated");
    expect(fp1).not.toBe(fp2);
  });

  it("returns different fingerprints for different titles", () => {
    const fp1 = generateFingerprint("/dashboard", "Button truncated");
    const fp2 = generateFingerprint("/dashboard", "Layout overflow");
    expect(fp1).not.toBe(fp2);
  });

  it("starts with qa- prefix", () => {
    const fp = generateFingerprint("/dashboard", "Test");
    expect(fp).toMatch(/^qa-[a-z0-9]+$/);
  });

  it("is case-insensitive", () => {
    const fp1 = generateFingerprint("/Dashboard", "Button Truncated");
    const fp2 = generateFingerprint("/dashboard", "button truncated");
    expect(fp1).toBe(fp2);
  });
});

// ── Label Assignment ────────────────────────────────────────────────────────

describe("getLabelsForFinding", () => {
  const baseFinding: Finding = {
    title: "Test",
    description: "Test",
    severity: "major",
    confidence: 0.8,
    complexity: "simple",
    viewport: "both",
  };

  it("returns simple-fix labels for simple findings", () => {
    const labels = getLabelsForFinding(baseFinding);
    expect(labels).toEqual(["qa-audit", "needs-triage", "simple-fix"]);
  });

  it("returns complex labels for complex findings", () => {
    const labels = getLabelsForFinding({
      ...baseFinding,
      complexity: "complex",
    });
    expect(labels).toEqual(["qa-audit", "needs-triage", "complex"]);
  });

  it("always includes qa-audit and needs-triage", () => {
    const simpleLabels = getLabelsForFinding(baseFinding);
    const complexLabels = getLabelsForFinding({
      ...baseFinding,
      complexity: "complex",
    });
    expect(simpleLabels).toContain("qa-audit");
    expect(simpleLabels).toContain("needs-triage");
    expect(complexLabels).toContain("qa-audit");
    expect(complexLabels).toContain("needs-triage");
  });
});

// ── Slug Sanitization ───────────────────────────────────────────────────────

describe("sanitizeSlug", () => {
  it("replaces slashes with underscores", () => {
    expect(sanitizeSlug("/dashboard/posts")).toBe("_dashboard_posts");
  });

  it("replaces brackets with underscores", () => {
    expect(sanitizeSlug("/dashboard/posts/[id]/edit")).toBe(
      "_dashboard_posts__id__edit"
    );
  });

  it("preserves alphanumeric and hyphens", () => {
    expect(sanitizeSlug("my-route-123")).toBe("my-route-123");
  });

  it("replaces spaces with underscores", () => {
    expect(sanitizeSlug("my route")).toBe("my_route");
  });
});

// ── Issue Body Builder ──────────────────────────────────────────────────────

describe("buildIssueBody", () => {
  const params: IssueBodyParams = {
    finding: {
      title: "Button text truncated",
      description: "The submit button text is cut off on mobile.",
      severity: "major",
      confidence: 0.85,
      complexity: "simple",
      viewport: "mobile",
    },
    route: {
      path: "/dashboard/posts",
      label: "Posts",
      suggestedFiles: ["src/app/dashboard/posts/page.tsx"],
    },
    resolvedPath: "/dashboard/posts",
    fingerprint: "qa-abc123",
    screenshotUrls: {
      mobile: "https://example.com/mobile.jpg",
      desktop: "https://example.com/desktop.jpg",
    },
  };

  it("includes fingerprint", () => {
    const body = buildIssueBody(params);
    expect(body).toContain("**Fingerprint:** `qa-abc123`");
  });

  it("includes severity", () => {
    const body = buildIssueBody(params);
    expect(body).toContain("**Severity:** major");
  });

  it("includes confidence as percentage", () => {
    const body = buildIssueBody(params);
    expect(body).toContain("**Confidence:** 85%");
  });

  it("includes screenshot images", () => {
    const body = buildIssueBody(params);
    expect(body).toContain("![mobile](https://example.com/mobile.jpg)");
    expect(body).toContain("![desktop](https://example.com/desktop.jpg)");
  });

  it("includes suggested files", () => {
    const body = buildIssueBody(params);
    expect(body).toContain(
      "- `src/app/dashboard/posts/page.tsx`"
    );
  });

  it("includes complexity classification", () => {
    const body = buildIssueBody(params);
    expect(body).toContain("**Simple fix**");
  });

  it("includes metadata comment for machine parsing", () => {
    const body = buildIssueBody(params);
    expect(body).toContain("<!-- qa-finding:");
    expect(body).toContain('"fingerprint":"qa-abc123"');
  });

  it("handles missing screenshot URLs", () => {
    const body = buildIssueBody({
      ...params,
      screenshotUrls: {},
    });
    expect(body).toContain("_No screenshots available (dry-run)_");
  });

  it("shows complex fix text for complex findings", () => {
    const body = buildIssueBody({
      ...params,
      finding: { ...params.finding, complexity: "complex" },
    });
    expect(body).toContain("**Complex fix**");
  });
});

// ── Prompt Builder ──────────────────────────────────────────────────────────

describe("buildUserPrompt", () => {
  it("includes route label and path", () => {
    const prompt = buildUserPrompt(
      { path: "/dashboard/posts", label: "Posts", suggestedFiles: [] },
      "/dashboard/posts"
    );
    expect(prompt).toContain("Posts");
    expect(prompt).toContain("/dashboard/posts");
  });

  it("mentions mobile and desktop", () => {
    const prompt = buildUserPrompt(
      { path: "/dashboard", label: "Dashboard", suggestedFiles: [] },
      "/dashboard"
    );
    expect(prompt).toContain("mobile");
    expect(prompt).toContain("desktop");
  });
});

// ── Config Constants ────────────────────────────────────────────────────────

describe("config constants", () => {
  it("has routes in manifest and excludes dev-tools", () => {
    expect(ROUTE_MANIFEST.length).toBeGreaterThan(0);
    expect(ROUTE_MANIFEST.find((r) => r.path.includes("dev-tools"))).toBeUndefined();
  });

  it("has 2 viewports", () => {
    expect(VIEWPORTS).toHaveLength(2);
    expect(VIEWPORTS.map((v) => v.name)).toEqual(["mobile", "desktop"]);
  });

  it("mobile viewport is 375px", () => {
    const mobile = VIEWPORTS.find((v) => v.name === "mobile");
    expect(mobile?.width).toBe(375);
  });

  it("desktop viewport is 1440px", () => {
    const desktop = VIEWPORTS.find((v) => v.name === "desktop");
    expect(desktop?.width).toBe(1440);
  });

  it("system prompt is non-empty", () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  it("all routes have suggestedFiles", () => {
    for (const route of ROUTE_MANIFEST) {
      expect(route.suggestedFiles.length).toBeGreaterThan(0);
    }
  });
});
