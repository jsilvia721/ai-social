import { deduplicateByRepurposeGroup } from "@/lib/analytics/dedup";

interface MockPost {
  id: string;
  content: string;
  metricsLikes: number | null;
  repurposeGroupId: string | null;
  socialAccount: { platform: string; username: string };
}

function makePost(overrides: Partial<MockPost> & { id: string }): MockPost {
  return {
    content: "Test post content",
    metricsLikes: 0,
    repurposeGroupId: null,
    socialAccount: { platform: "TWITTER", username: "testuser" },
    ...overrides,
  };
}

describe("deduplicateByRepurposeGroup", () => {
  it("returns all posts when none have repurposeGroupId", () => {
    const posts = [
      makePost({ id: "1", metricsLikes: 10 }),
      makePost({ id: "2", metricsLikes: 20 }),
      makePost({ id: "3", metricsLikes: 5 }),
    ];
    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("keeps only the highest-likes post from each repurpose group", () => {
    const posts = [
      makePost({ id: "1", metricsLikes: 10, repurposeGroupId: "group-a" }),
      makePost({ id: "2", metricsLikes: 50, repurposeGroupId: "group-a" }),
      makePost({ id: "3", metricsLikes: 30, repurposeGroupId: "group-a" }),
    ];
    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("handles mix of grouped and ungrouped posts", () => {
    const posts = [
      makePost({ id: "1", metricsLikes: 10 }),
      makePost({ id: "2", metricsLikes: 50, repurposeGroupId: "group-a" }),
      makePost({ id: "3", metricsLikes: 30, repurposeGroupId: "group-a" }),
      makePost({ id: "4", metricsLikes: 5 }),
      makePost({ id: "5", metricsLikes: 100, repurposeGroupId: "group-b" }),
      makePost({ id: "6", metricsLikes: 80, repurposeGroupId: "group-b" }),
    ];
    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(4);
    expect(result.map((p) => p.id)).toEqual(["1", "2", "4", "5"]);
  });

  it("preserves original order (ungrouped in place, grouped at first occurrence)", () => {
    const posts = [
      makePost({ id: "1", metricsLikes: 5, repurposeGroupId: "group-a" }),
      makePost({ id: "2", metricsLikes: 20 }),
      makePost({ id: "3", metricsLikes: 50, repurposeGroupId: "group-a" }),
    ];
    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(2);
    // group-a winner (id:3) takes the position of the first group-a post
    expect(result[0].id).toBe("3");
    expect(result[1].id).toBe("2");
  });

  it("treats null metricsLikes as 0 when comparing", () => {
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

  it("handles single post", () => {
    const posts = [makePost({ id: "1", metricsLikes: 10 })];
    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("handles multiple separate repurpose groups", () => {
    const posts = [
      makePost({ id: "1", metricsLikes: 10, repurposeGroupId: "group-a" }),
      makePost({ id: "2", metricsLikes: 20, repurposeGroupId: "group-b" }),
      makePost({ id: "3", metricsLikes: 30, repurposeGroupId: "group-a" }),
      makePost({ id: "4", metricsLikes: 5, repurposeGroupId: "group-b" }),
    ];
    const result = deduplicateByRepurposeGroup(posts);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual(["3", "2"]);
  });
});
