/**
 * Tests for the bug issue marker parsing logic used in close-completed-plans.yml
 */

// Extract the parsing logic so it can be tested independently
export function parseBugIssueMarker(body: string): number | null {
  const match = body.match(/<!-- BUG_ISSUE: #(\d+) -->/);
  return match ? parseInt(match[1], 10) : null;
}

describe("close-completed-plans bug issue marker", () => {
  describe("parseBugIssueMarker", () => {
    it("should extract bug issue number from marker", () => {
      const body =
        "Some plan content\n<!-- BUG_ISSUE: #42 -->\nMore content";
      expect(parseBugIssueMarker(body)).toBe(42);
    });

    it("should return null when no marker is present", () => {
      const body = "Some plan content without a marker";
      expect(parseBugIssueMarker(body)).toBeNull();
    });

    it("should handle marker at start of body", () => {
      const body = "<!-- BUG_ISSUE: #100 -->\nPlan content";
      expect(parseBugIssueMarker(body)).toBe(100);
    });

    it("should handle marker at end of body", () => {
      const body = "Plan content\n<!-- BUG_ISSUE: #7 -->";
      expect(parseBugIssueMarker(body)).toBe(7);
    });

    it("should only match the first marker if multiple exist", () => {
      const body =
        "<!-- BUG_ISSUE: #10 -->\n<!-- BUG_ISSUE: #20 -->";
      expect(parseBugIssueMarker(body)).toBe(10);
    });

    it("should not match malformed markers", () => {
      expect(parseBugIssueMarker("<!-- BUG_ISSUE: 42 -->")).toBeNull();
      expect(parseBugIssueMarker("<!-- BUG_ISSUE #42 -->")).toBeNull();
      expect(parseBugIssueMarker("BUG_ISSUE: #42")).toBeNull();
    });

    it("should handle large issue numbers", () => {
      const body = "<!-- BUG_ISSUE: #99999 -->";
      expect(parseBugIssueMarker(body)).toBe(99999);
    });
  });
});
