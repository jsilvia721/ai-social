/**
 * Shared Prisma select for ContentStrategy queries.
 * Used by both the strategy page (server component) and API route
 * to keep field lists in sync.
 */
export const STRATEGY_SELECT = {
  industry: true,
  targetAudience: true,
  contentPillars: true,
  brandVoice: true,
  optimizationGoal: true,
  reviewWindowEnabled: true,
  reviewWindowHours: true,
  postingCadence: true,
  formatMix: true,
  researchSources: true,
  optimalTimeWindows: true,
  lastOptimizedAt: true,
  updatedAt: true,
  accountType: true,
  visualStyle: true,
} as const;
