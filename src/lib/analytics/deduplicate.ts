/**
 * Deduplicates posts that share a repurposeGroupId, keeping only the
 * variant with the highest likes count. Posts without a repurposeGroupId
 * are always retained. The original array order is preserved — group
 * winners appear at the position of the first group member encountered.
 */
export function deduplicateByRepurposeGroup<
  T extends { repurposeGroupId: string | null; metricsLikes: number | null },
>(posts: T[]): T[] {
  // Map groupId -> best post in that group
  const groupWinners = new Map<string, T>();

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const groupId = post.repurposeGroupId;

    if (!groupId) continue;

    const current = groupWinners.get(groupId);
    if (
      !current ||
      (post.metricsLikes ?? 0) > (current.metricsLikes ?? 0)
    ) {
      groupWinners.set(groupId, post);
    }
  }

  // Build result preserving order
  const seen = new Set<string>();
  const result: T[] = [];

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const groupId = post.repurposeGroupId;

    if (!groupId) {
      // Non-grouped posts always included
      result.push(post);
    } else if (!seen.has(groupId)) {
      // First time seeing this group — insert the winner
      seen.add(groupId);
      result.push(groupWinners.get(groupId)!);
    }
    // Otherwise skip — duplicate group member
  }

  return result;
}
