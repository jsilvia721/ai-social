import { formatFeedbackIssue } from "@/lib/feedback-formatter";

describe("formatFeedbackIssue", () => {
  const baseParams = {
    summary: "The login button is not working",
    userName: "Josh",
  };

  describe("bug classification", () => {
    it("returns title with [Bug] prefix", () => {
      const result = formatFeedbackIssue({
        ...baseParams,
        classification: "bug",
      });
      expect(result.title).toMatch(/^\[Bug\] /);
      expect(result.title).toContain("The login button is not working");
    });

    it("includes bug and needs-human-review labels", () => {
      const result = formatFeedbackIssue({
        ...baseParams,
        classification: "bug",
      });
      expect(result.labels).toEqual(["bug", "needs-human-review"]);
    });

    it("includes Steps to Reproduce, Expected Behavior, Actual Behavior sections", () => {
      const result = formatFeedbackIssue({
        ...baseParams,
        classification: "bug",
      });
      expect(result.body).toContain("## Steps to Reproduce");
      expect(result.body).toContain("## Expected Behavior");
      expect(result.body).toContain("## Actual Behavior");
    });

    it("includes page URL when provided", () => {
      const result = formatFeedbackIssue({
        ...baseParams,
        classification: "bug",
        pageUrl: "http://localhost:3000/dashboard",
      });
      // pageUrl is Markdown-escaped in the body for injection prevention
      expect(result.body).toContain("localhost");
      expect(result.body).toContain("dashboard");
    });

    it("includes screenshot when provided", () => {
      const result = formatFeedbackIssue({
        ...baseParams,
        classification: "bug",
        screenshotUrl: "https://storage.example.com/screenshot.png",
      });
      expect(result.body).toContain(
        "![Screenshot](https://storage.example.com/screenshot.png)"
      );
    });
  });

  describe("feature classification", () => {
    it("returns title with [Feature] prefix", () => {
      const result = formatFeedbackIssue({
        ...baseParams,
        classification: "feature",
      });
      expect(result.title).toMatch(/^\[Feature\] /);
    });

    it("includes enhancement and needs-human-review labels", () => {
      const result = formatFeedbackIssue({
        ...baseParams,
        classification: "feature",
      });
      expect(result.labels).toEqual(["enhancement", "needs-human-review"]);
    });

    it("includes Use Case, Proposed Behavior, Acceptance Criteria sections", () => {
      const result = formatFeedbackIssue({
        ...baseParams,
        classification: "feature",
      });
      expect(result.body).toContain("## Use Case");
      expect(result.body).toContain("## Proposed Behavior");
      expect(result.body).toContain("## Acceptance Criteria");
    });
  });

  describe("general classification", () => {
    it("returns title with [Feedback] prefix", () => {
      const result = formatFeedbackIssue({
        ...baseParams,
        classification: "general",
      });
      expect(result.title).toMatch(/^\[Feedback\] /);
    });

    it("includes only needs-human-review label", () => {
      const result = formatFeedbackIssue({
        ...baseParams,
        classification: "general",
      });
      expect(result.labels).toEqual(["needs-human-review"]);
    });
  });

  it("includes user name and date in body", () => {
    const result = formatFeedbackIssue({
      ...baseParams,
      classification: "general",
    });
    expect(result.body).toContain("**From:** Josh");
  });

  it("truncates long summary in title to 80 chars max", () => {
    const longSummary =
      "This is a very long summary that should be truncated because it exceeds the maximum title length allowed for a GitHub issue";
    const result = formatFeedbackIssue({
      ...baseParams,
      summary: longSummary,
      classification: "bug",
    });
    expect(result.title.length).toBeLessThanOrEqual(80);
    expect(result.title).toMatch(/…$/);
  });

  it("escapes Markdown metacharacters in userName to prevent injection", () => {
    const result = formatFeedbackIssue({
      ...baseParams,
      userName: "evil](https://evil.com)",
      classification: "general",
    });
    // Brackets and parens should be escaped
    expect(result.body).not.toContain("](https://evil.com)");
    expect(result.body).toContain("\\]");
    expect(result.body).toContain("\\(");
  });

  it("escapes Markdown metacharacters in pageUrl", () => {
    const result = formatFeedbackIssue({
      ...baseParams,
      classification: "general",
      pageUrl: "http://example.com/page?x=1&y=2#section",
    });
    // Hash should be escaped to prevent heading injection
    expect(result.body).toContain("\\#section");
  });

  it("shows Not captured when pageUrl is not provided", () => {
    const result = formatFeedbackIssue({
      ...baseParams,
      classification: "general",
    });
    expect(result.body).toContain("Not captured");
  });
});
