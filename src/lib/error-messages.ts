/**
 * Maps raw API error messages to user-friendly messages.
 * Prevents exposing internal error details (JSON payloads, status codes) to users.
 */

const BLOTATO_API_ERROR_PATTERN = /^Blotato API error (\d+):/;

export function friendlyErrorMessage(raw: string): string {
  const match = raw.match(BLOTATO_API_ERROR_PATTERN);

  if (match) {
    const status = parseInt(match[1], 10);

    if (status === 401 || status === 403) {
      return "Unable to connect to Blotato. Please reconnect your account.";
    }

    if (status === 429) {
      return "Blotato is temporarily unavailable due to rate limiting. Please try again in a few minutes.";
    }

    if (status >= 500) {
      return "Blotato is experiencing issues. Please try again later.";
    }

    return "Something went wrong connecting to Blotato. Please try again.";
  }

  // Network errors (Failed to fetch, etc.)
  if (raw === "Failed to fetch" || raw.includes("fetch")) {
    // Don't catch messages that are already friendly (contain "Blotato")
    if (raw.includes("Blotato")) {
      return raw;
    }
    return "Could not reach Blotato. Please check your connection and try again.";
  }

  return raw;
}
