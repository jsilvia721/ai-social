/**
 * In-memory sliding-window rate limiter.
 *
 * Tracks request timestamps per user. On each call, evicts entries outside
 * the window, then checks whether the user has remaining capacity.
 */

interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

// userId → array of request timestamps (ms)
const requestLog = new Map<string, number[]>();

export function checkRateLimit(
  userId: string,
  { maxRequests, windowMs }: RateLimitOptions
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  // Get or create log for this user
  let timestamps = requestLog.get(userId) ?? [];

  // Evict expired entries
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= maxRequests) {
    // Over limit — compute when the oldest entry in the window expires
    const oldestInWindow = timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    requestLog.set(userId, timestamps);
    return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  // Under limit — record this request
  timestamps.push(now);
  requestLog.set(userId, timestamps);
  return { allowed: true, retryAfterMs: 0 };
}

/** Test-only: clear all rate limit state. */
export function _resetAllLimits(): void {
  requestLog.clear();
}
