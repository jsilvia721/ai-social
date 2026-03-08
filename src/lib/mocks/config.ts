/**
 * Central config for external API mocking.
 *
 * When MOCK_EXTERNAL_APIS=true (the default for non-production),
 * all paid external API calls return realistic mock data instead of
 * hitting real endpoints. This prevents cost from Anthropic, Blotato,
 * SerpAPI, and social platform APIs during development and staging.
 *
 * AWS services (S3, SES, EventBridge) and the database are NOT mocked.
 */
export function shouldMockExternalApis(): boolean {
  // Explicit env var takes priority
  if (process.env.MOCK_EXTERNAL_APIS === "true") return true;
  if (process.env.MOCK_EXTERNAL_APIS === "false") return false;

  // Default: mock in development and test, live in production
  return process.env.NODE_ENV !== "production";
}
