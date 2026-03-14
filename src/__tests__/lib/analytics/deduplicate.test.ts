import { deduplicateByRepurposeGroup } from "@/lib/analytics/deduplicate";

function makePost(overrides: {
  id: string;
  metricsLikes?: number | null;
  repurposeGroupId?: string | null;
  content?: string;
}) {
  return {
    id: overrides.id,
    metricsLikes: overrides.metricsLikes ?? 0,
    repurposeGroupId: overrides.repurposeGroupId ?? null,
    content: overrides.content ?? "Some post content",
  };
}

describe("deduplicateByRepurposeGroup", () => {
  it("returns all posts when none share a repurposeGroupId", () => {
    const posts = [
      makePost({ id: "1", metricsLikes: 10 }),
      makePost({ id: "2", metricsLikes: 20 }),
      makePost({ id: "3", metricsLikes: 5 }),
    ];

    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("keeps only the highest-likes variant from a repurpose group", () => {
    const posts = [
      makePost({ id: "1", metricsLikes: 10, repurposeGroupId: "group-a" }),
      makePost({ id: "2", metricsLikes: 50, repurposeGroupId: "group-a" }),
      makePost({ id: "3", metricsLikes: 30, repurposeGroupId: "group-a" }),
    ];

    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("deduplicates multiple groups independently", () => {
    const posts = [
      makePost({ id: "1", metricsLikes: 10, repurposeGroupId: "group-a" }),
      makePost({ id: "2", metricsLikes: 50, repurposeGroupId: "group-a" }),
      makePost({ id: "3", metricsLikes: 30, repurposeGroupId: "group-b" }),
      makePost({ id: "4", metricsLikes: 40, repurposeGroupId: "group-b" }),
      makePost({ id: "5", metricsLikes: 5 }), // no group
    ];

    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.id).sort()).toEqual(["2", "4", "5"]);
  });

  it("preserves original order for non-grouped posts", () => {
    const posts = [
      makePost({ id: "1", metricsLikes: 5 }),
      makePost({ id: "2", metricsLikes: 20, repurposeGroupId: "group-a" }),
      makePost({ id: "3", metricsLikes: 50, repurposeGroupId: "group-a" }),
      makePost({ id: "4", metricsLikes: 10 }),
    ];

    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(3);
    // Group winner (id=3) should appear at the position of the first group member (index 1)
    expect(result[0].id).toBe("1");
    expect(result[1].id).toBe("3");
    expect(result[2].id).toBe("4");
  });

  it("handles null metricsLikes as zero", () => {
    const posts = [
      makePost({ id: "1", metricsLikes: null, repurposeGroupId: "group-a" }),
      makePost({ id: "2", metricsLikes: 5, repurposeGroupId: "group-a" }),
    ];

    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("returns empty array for empty input", () => {
    expect(deduplicateByRepurposeGroup([])).toEqual([]);
  });

  it("handles single post in a repurpose group", () => {
    const posts = [
      makePost({ id: "1", metricsLikes: 10, repurposeGroupId: "group-a" }),
    ];

    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });
});
