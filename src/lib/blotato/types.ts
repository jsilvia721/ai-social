import { z } from "zod";

export const BlotatoAccountSchema = z.object({
  id: z.string(),
  platform: z.string(),
  username: z.string(),
  platformId: z.string().optional(),
});

export const BlotatoConnectUrlSchema = z.object({
  url: z.string().url(),
});

export const BlotatoPublishResultSchema = z.object({
  id: z.string(),
  status: z.string(),
});

export const BlotatoPostMetricsSchema = z.object({
  likes: z.number().default(0),
  comments: z.number().default(0),
  shares: z.number().default(0),
  impressions: z.number().default(0),
  reach: z.number().default(0),
  saves: z.number().default(0),
});

export type BlotatoAccount = z.infer<typeof BlotatoAccountSchema>;
export type BlotatoPublishResult = z.infer<typeof BlotatoPublishResultSchema>;
export type BlotatoPostMetrics = z.infer<typeof BlotatoPostMetricsSchema>;
