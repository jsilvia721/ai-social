const GENERIC_MESSAGE = "Publishing failed — try again or edit your post";

/**
 * Technical error patterns that should be replaced with a user-friendly message.
 * These are raw errors from network failures, timeouts, etc. that provide
 * no actionable information to the user.
 */
const TECHNICAL_ERROR_PATTERNS = [
  /fetch failed/i,
  /network error/i,
  /etimedout/i,
  /econnrefused/i,
  /econnreset/i,
  /socket hang up/i,
  /abort/i,
];

/**
 * Formats a raw post error message into a user-friendly string.
 * Technical/network errors are replaced with a generic message.
 * Meaningful errors (e.g. "content exceeds character limit") are passed through.
 */
export function formatPostError(
  errorMessage: string | null | undefined
): string | null {
  if (errorMessage == null) return null;

  const trimmed = errorMessage.trim();
  if (trimmed === "") return GENERIC_MESSAGE;

  for (const pattern of TECHNICAL_ERROR_PATTERNS) {
    if (pattern.test(trimmed)) return GENERIC_MESSAGE;
  }

  return trimmed;
}
