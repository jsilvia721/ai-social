/**
 * Shared types for AI functions.
 * Used by repurposeContent, analyzePerformance, and generateBriefs.
 */

export interface StrategyContext {
  industry: string;
  targetAudience: string;
  contentPillars: string[];
  brandVoice: string;
}
