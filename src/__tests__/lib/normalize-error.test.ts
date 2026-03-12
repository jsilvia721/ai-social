import { normalizeMessage } from "@/lib/normalize-error";

describe("normalizeMessage", () => {
  describe("UUID replacement", () => {
    it("replaces UUIDs with <UUID>", () => {
      expect(
        normalizeMessage(
          "Failed to load post 550e8400-e29b-41d4-a716-446655440000"
        )
      ).toBe("Failed to load post <UUID>");
    });

    it("replaces multiple UUIDs", () => {
      expect(
        normalizeMessage(
          "Copy 550e8400-e29b-41d4-a716-446655440000 to 6ba7b810-9dad-11d1-80b4-00c04fd430c8"
        )
      ).toBe("Copy <UUID> to <UUID>");
    });

    it("handles uppercase UUIDs", () => {
      expect(
        normalizeMessage("ID: 550E8400-E29B-41D4-A716-446655440000")
      ).toBe("ID: <UUID>");
    });
  });

  describe("CUID/nanoid replacement", () => {
    it("replaces CUIDs with <ID>", () => {
      expect(
        normalizeMessage("Record cjld2cjxh0000qzrmn831i7rn not found")
      ).toBe("Record <ID> not found");
    });

    it("replaces long nanoid-style IDs", () => {
      expect(
        normalizeMessage("Session clz1abc2def3ghi4jkl5mno6p expired")
      ).toBe("Session <ID> expired");
    });

    it("does not replace short strings", () => {
      // 'title' is only 5 chars, should not be replaced
      expect(normalizeMessage("reading 'title'")).toBe("reading 'title'");
    });
  });

  describe("timestamp replacement", () => {
    it("replaces ISO timestamps with <TIMESTAMP>", () => {
      expect(
        normalizeMessage("Error at 2024-01-15T14:30:00.000Z")
      ).toBe("Error at <TIMESTAMP>");
    });

    it("replaces ISO timestamps without Z suffix", () => {
      expect(
        normalizeMessage("Error at 2024-01-15T14:30:00.000")
      ).toBe("Error at <TIMESTAMP>");
    });

    it("replaces datetime strings", () => {
      expect(
        normalizeMessage("Failed since 2024-01-15 14:30:00")
      ).toBe("Failed since <TIMESTAMP>");
    });
  });

  describe("number replacement", () => {
    it("replaces standalone numbers with <N>", () => {
      expect(normalizeMessage("Error code 500 on line 42")).toBe(
        "Error code <N> on line <N>"
      );
    });

    it("does not replace numbers within words", () => {
      // After CUID/ID replacement, we don't want partial matches
      expect(normalizeMessage("TypeError")).toBe("TypeError");
    });
  });

  describe("query string stripping", () => {
    it("strips query strings", () => {
      expect(
        normalizeMessage("Failed to fetch /api/posts?page=1&limit=10")
      ).toBe("Failed to fetch /api/posts");
    });

    it("strips query strings with complex values", () => {
      expect(
        normalizeMessage("GET /api/data?token=abc123&filter=active failed")
      ).toBe("GET /api/data failed");
    });
  });

  describe("whitespace collapsing", () => {
    it("collapses multiple spaces", () => {
      expect(normalizeMessage("error   in    module")).toBe("error in module");
    });

    it("trims leading and trailing whitespace", () => {
      expect(normalizeMessage("  error message  ")).toBe("error message");
    });

    it("collapses tabs and newlines", () => {
      expect(normalizeMessage("error\n\tin\tmodule")).toBe("error in module");
    });
  });

  describe("should NOT normalize", () => {
    it("preserves error class names", () => {
      expect(
        normalizeMessage("TypeError: Cannot read properties of undefined")
      ).toBe("TypeError: Cannot read properties of undefined");
    });

    it("preserves property names in error messages", () => {
      expect(
        normalizeMessage(
          "TypeError: Cannot read properties of undefined (reading 'title')"
        )
      ).toBe(
        "TypeError: Cannot read properties of undefined (reading 'title')"
      );
    });

    it("preserves file paths", () => {
      expect(
        normalizeMessage("Error in /src/components/PostCard.tsx")
      ).toBe("Error in /src/components/PostCard.tsx");
    });

    it("preserves HTTP methods", () => {
      expect(normalizeMessage("GET /api/posts failed")).toBe(
        "GET /api/posts failed"
      );
    });

    it("preserves RangeError", () => {
      expect(normalizeMessage("RangeError: Maximum call stack size exceeded")).toBe(
        "RangeError: Maximum call stack size exceeded"
      );
    });
  });

  describe("combined normalization", () => {
    it("applies all rules in order", () => {
      const input =
        "Failed to load post 550e8400-e29b-41d4-a716-446655440000 at 2024-01-15T14:30:00.000Z with status 404";
      expect(normalizeMessage(input)).toBe(
        "Failed to load post <UUID> at <TIMESTAMP> with status <N>"
      );
    });

    it("handles a message with ID, timestamp, number, and query string", () => {
      const input =
        "Error fetching /api/posts?page=2 for session clz1abc2def3ghi4jkl5mno6p at 2024-06-01 12:00:00 code 500";
      expect(normalizeMessage(input)).toBe(
        "Error fetching /api/posts for session <ID> at <TIMESTAMP> code <N>"
      );
    });
  });
});
