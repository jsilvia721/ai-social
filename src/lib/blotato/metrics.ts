import { blotatoFetch } from "./client";
import { BlotatoPostMetricsSchema, type BlotatoPostMetrics } from "./types";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import { mockGetPostMetrics } from "@/lib/mocks/blotato";

export async function getPostMetrics(blotatoPostId: string): Promise<BlotatoPostMetrics> {
  if (shouldMockExternalApis()) return mockGetPostMetrics();
  return blotatoFetch(`/posts/${blotatoPostId}/metrics`, BlotatoPostMetricsSchema);
}
