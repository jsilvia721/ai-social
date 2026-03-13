/**
 * Zod schemas and TypeScript types for the brainstorm generation pipeline.
 */
import { z } from "zod";

export const BrainstormItemSchema = z.object({
  title: z.string().min(1),
  rationale: z.string().min(1),
  scope: z.enum(["Small", "Medium", "Large"]),
  visionAlignment: z.string().min(1),
  category: z.enum(["Intelligence", "Infrastructure", "UX", "Growth", "Operations"]),
});

export type BrainstormItem = z.infer<typeof BrainstormItemSchema>;

export const BrainstormOutputSchema = z.object({
  projectSummary: z.string().min(1),
  researchInsights: z.string().min(1),
  items: z.array(BrainstormItemSchema).min(5).max(7),
});

export type BrainstormOutput = z.infer<typeof BrainstormOutputSchema>;

export interface ParsedBrainstormItem {
  index: number;
  title: string;
  checked: boolean;
  hasPlanLink: boolean;
  planIssueNumber?: number;
}
