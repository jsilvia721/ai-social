import { blotatoFetch } from "./client";
import { BlotatoPostMetricsSchema, type BlotatoPostMetrics } from "./types";

export async function getPostMetrics(blotatoPostId: string): Promise<BlotatoPostMetrics> {
  return blotatoFetch(`/posts/${blotatoPostId}/metrics`, BlotatoPostMetricsSchema);
}
