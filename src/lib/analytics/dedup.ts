/**
 * Deduplicate posts that share a repurposeGroupId, keeping only the
 * best-performing post (highest metricsLikes) from each group.
 * Posts without a repurposeGroupId are always included.
 * Preserves original order — grouped posts appear at the position of
 * the first occurrence of their group.
 */
export function deduplicateByRepurposeGroup<
  T extends { repurposeGroupId: string | null; metricsLikes: number | null },
>(posts: T[]): T[] {
  // First pass: find the winner for each repurpose group
  const groupWinners = new Map<string, T>();
  for (const post of posts) {
    const gid = post.repurposeGroupId;
    if (!gid) continue;
    const current = groupWinners.get(gid);
    if (!current || (post.metricsLikes ?? 0) > (current.metricsLikes ?? 0)) {
      groupWinners.set(gid, post);
    }
  }

  // Second pass: build result preserving order
  const seenGroups = new Set<string>();
  const result: T[] = [];
  for (const post of posts) {
    const gid = post.repurposeGroupId;
    if (!gid) {
      result.push(post);
    } else if (!seenGroups.has(gid)) {
      seenGroups.add(gid);
      result.push(groupWinners.get(gid)!);
    }
    // else: duplicate from already-seen group, skip
  }

  return result;
}
