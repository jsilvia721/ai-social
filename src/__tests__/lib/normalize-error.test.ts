import { normalizeMessage } from "@/lib/normalize-error";

describe("normalizeMessage", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeMessage("")).toBe("");
  });

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

  describe("compound hyphenated ID replacement", () => {
    it("replaces seed-style compound IDs", () => {
      expect(
        normalizeMessage("posts/seed-blotato-post-1772985511806-xa5g/metrics")
      ).toBe("posts/<COMPOUND_ID>/metrics");
    });

    it("replaces different compound IDs to the same placeholder", () => {
      const a = normalizeMessage(
        "posts/seed-blotato-post-1772985511806-xa5g/metrics"
      );
      const b = normalizeMessage(
        "posts/seed-blotato-post-1773021279727-4uvf/metrics"
      );
      expect(a).toBe(b);
    });

    it("replaces generic compound IDs with number and short suffix", () => {
      expect(normalizeMessage("my-resource-12345-abc")).toBe("<COMPOUND_ID>");
    });

    it("preserves simple hyphenated words without numeric segments", () => {
      expect(normalizeMessage("auto-approval")).toBe("auto-approval");
    });

    it("preserves file paths with hyphens", () => {
      expect(normalizeMessage("post-card.tsx")).toBe("post-card.tsx");
    });

    it("replaces compound ID with numeric suffix like a9a3", () => {
      expect(
        normalizeMessage("posts/seed-blotato-post-1772985511798-a9a3/metrics")
      ).toBe("posts/<COMPOUND_ID>/metrics");
    });

    it("replaces compound ID with single prefix segment", () => {
      expect(normalizeMessage("word-123-abc")).toBe("<COMPOUND_ID>");
    });

    it("does not replace when suffix exceeds 8 chars", () => {
      expect(normalizeMessage("prefix-123-abcdefghi")).toBe(
        "prefix-<N>-abcdefghi"
      );
    });
  });

  describe("integration: issues #337-339 produce identical output", () => {
    const msg337 =
      '[metrics-refresh] Failed to refresh metrics for post cmmhxsoe6000c02l8bwx5jrsr: Blotato API error 404: {"message":"Route GET:/v2/posts/seed-blotato-post-1772985511806-xa5g/metrics not found","error":"Not Found","statusCode":404}';
    const msg338 =
      '[metrics-refresh] Failed to refresh metrics for post cmmij3b4i000a02l526nz47xb: Blotato API error 404: {"message":"Route GET:/v2/posts/seed-blotato-post-1773021279727-4uvf/metrics not found","error":"Not Found","statusCode":404}';
    const msg339 =
      '[metrics-refresh] Failed to refresh metrics for post cmmhxsoe0000b02l8shft5ctj: Blotato API error 404: {"message":"Route GET:/v2/posts/seed-blotato-post-1772985511798-a9a3/metrics not found","error":"Not Found","statusCode":404}';

    it("all three messages normalize to the same string", () => {
      const n337 = normalizeMessage(msg337);
      const n338 = normalizeMessage(msg338);
      const n339 = normalizeMessage(msg339);
      expect(n337).toBe(n338);
      expect(n338).toBe(n339);
    });

    it("normalizes CUIDs, compound IDs, and numbers", () => {
      const expected =
        '[metrics-refresh] Failed to refresh metrics for post <ID>: Blotato API error <N>: {"message":"Route GET:/v2/posts/<COMPOUND_ID>/metrics not found","error":"Not Found","statusCode":<N>}';
      expect(normalizeMessage(msg337)).toBe(expected);
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
