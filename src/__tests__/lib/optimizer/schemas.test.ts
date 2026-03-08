import {
  FormatMixSchema,
  TimeWindowsSchema,
  PerformanceAnalysisSchema,
  DigestPatternsSchema,
  DigestChangesSchema,
} from "@/lib/optimizer/schemas";

describe("FormatMixSchema", () => {
  it("accepts valid format mix", () => {
    const result = FormatMixSchema.safeParse({ TEXT: 0.2, IMAGE: 0.3, VIDEO: 0.5 });
    expect(result.success).toBe(true);
  });

  it("rejects values above 1", () => {
    const result = FormatMixSchema.safeParse({ TEXT: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects negative values", () => {
    const result = FormatMixSchema.safeParse({ TEXT: -0.1 });
    expect(result.success).toBe(false);
  });

  it("accepts empty object", () => {
    const result = FormatMixSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("TimeWindowsSchema", () => {
  it("accepts valid time windows", () => {
    const result = TimeWindowsSchema.safeParse({
      TWITTER: ["09:00-11:00", "17:00-19:00"],
      INSTAGRAM: ["11:00-14:00"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = TimeWindowsSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("PerformanceAnalysisSchema", () => {
  it("accepts valid analysis with all fields", () => {
    const result = PerformanceAnalysisSchema.safeParse({
      patterns: ["Video posts get 2x engagement", "Tuesday is best day"],
      formatMixChanges: { VIDEO: 0.1, TEXT: -0.1 },
      cadenceChanges: { TWITTER: 1 },
      topicInsights: ["Lean into tutorials"],
      digest: "This week your videos performed well.",
    });
    expect(result.success).toBe(true);
  });

  it("accepts minimal analysis (patterns + digest only)", () => {
    const result = PerformanceAnalysisSchema.safeParse({
      patterns: ["Not enough data yet"],
      digest: "Insufficient data for detailed analysis.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects format mix changes exceeding 0.2", () => {
    const result = PerformanceAnalysisSchema.safeParse({
      patterns: ["test"],
      formatMixChanges: { VIDEO: 0.5 },
      digest: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects format mix changes below -0.2", () => {
    const result = PerformanceAnalysisSchema.safeParse({
      patterns: ["test"],
      formatMixChanges: { TEXT: -0.3 },
      digest: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects cadence changes exceeding +/-2", () => {
    const result = PerformanceAnalysisSchema.safeParse({
      patterns: ["test"],
      cadenceChanges: { TWITTER: 5 },
      digest: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 5 patterns", () => {
    const result = PerformanceAnalysisSchema.safeParse({
      patterns: ["a", "b", "c", "d", "e", "f"],
      digest: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing patterns", () => {
    const result = PerformanceAnalysisSchema.safeParse({
      digest: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing digest", () => {
    const result = PerformanceAnalysisSchema.safeParse({
      patterns: ["test"],
    });
    expect(result.success).toBe(false);
  });
});

describe("DigestPatternsSchema", () => {
  it("accepts valid patterns", () => {
    const result = DigestPatternsSchema.safeParse({
      topPerformers: [
        { postId: "abc123", score: 8.5, format: "VIDEO", topicPillar: "tutorials" },
        { postId: "def456", score: 6.2, format: null, topicPillar: null },
      ],
      insights: ["Videos outperform images 2:1"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing topPerformers", () => {
    const result = DigestPatternsSchema.safeParse({
      insights: ["test"],
    });
    expect(result.success).toBe(false);
  });
});

describe("DigestChangesSchema", () => {
  it("accepts valid changes", () => {
    const result = DigestChangesSchema.safeParse({
      formatMix: { VIDEO: 0.1, TEXT: -0.1 },
      cadence: { TWITTER: 1 },
      topicInsights: ["More tutorials"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object", () => {
    const result = DigestChangesSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
