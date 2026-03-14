/**
 * Deduplicate posts that share a repurposeGroupId, keeping only the
 * best-performing post (highest metricsLikes) from each group.
 * Posts without a repurposeGroupId are always included.
 */
export function deduplicateByRepurposeGroup<
  T extends { repurposeGroupId: string | null; metricsLikes: number | null },
>(posts: T[]): T[] {
  const groupBest = new Map<string, T>();
  for (const post of posts) {
    const gid = post.repurposeGroupId;
    if (!gid) continue;
    const cur = groupBest.get(gid);
    if (!cur || (post.metricsLikes ?? 0) > (cur.metricsLikes ?? 0)) {
      groupBest.set(gid, post);
    }
  }
  return posts.filter(
    (p) => !p.repurposeGroupId || groupBest.get(p.repurposeGroupId) === p,
  );
}
