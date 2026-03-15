import { checkRateLimit, _resetAllLimits } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetAllLimits();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("allows requests under the limit", () => {
    const result = checkRateLimit("user-1", { maxRequests: 5, windowMs: 3600000 });
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("allows requests up to the limit", () => {
    for (let i = 0; i < 4; i++) {
      checkRateLimit("user-1", { maxRequests: 5, windowMs: 3600000 });
    }
    const result = checkRateLimit("user-1", { maxRequests: 5, windowMs: 3600000 });
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("rejects requests over the limit", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("user-1", { maxRequests: 5, windowMs: 3600000 });
    }
    const result = checkRateLimit("user-1", { maxRequests: 5, windowMs: 3600000 });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(3600000);
  });

  it("allows requests after window expires", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("user-1", { maxRequests: 5, windowMs: 3600000 });
    }

    // Advance time past the window
    jest.advanceTimersByTime(3600001);

    const result = checkRateLimit("user-1", { maxRequests: 5, windowMs: 3600000 });
    expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
  });

  it("tracks users independently", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("user-1", { maxRequests: 5, windowMs: 3600000 });
    }

    const result1 = checkRateLimit("user-1", { maxRequests: 5, windowMs: 3600000 });
    expect(result1.allowed).toBe(false);

    const result2 = checkRateLimit("user-2", { maxRequests: 5, windowMs: 3600000 });
    expect(result2.allowed).toBe(true);
  });

  it("uses sliding window - oldest requests expire individually", () => {
    // Spread 3 requests across time
    checkRateLimit("user-1", { maxRequests: 3, windowMs: 3000 }); // t=0
    jest.advanceTimersByTime(1000);
    checkRateLimit("user-1", { maxRequests: 3, windowMs: 3000 }); // t=1000
    jest.advanceTimersByTime(1000);
    checkRateLimit("user-1", { maxRequests: 3, windowMs: 3000 }); // t=2000

    // At limit at t=2000 — should be rejected
    let result = checkRateLimit("user-1", { maxRequests: 3, windowMs: 3000 });
    expect(result.allowed).toBe(false);

    // Advance so only the first request (t=0) expires, not the others
    jest.advanceTimersByTime(1001); // now at t=3001

    // One slot freed — should be allowed
    result = checkRateLimit("user-1", { maxRequests: 3, windowMs: 3000 });
    expect(result.allowed).toBe(true);
  });

  it("returns correct retryAfterMs value", () => {
    // Make 5 requests at time 0
    for (let i = 0; i < 5; i++) {
      checkRateLimit("user-1", { maxRequests: 5, windowMs: 3600000 });
    }

    // Advance 1 second
    jest.advanceTimersByTime(1000);

    const result = checkRateLimit("user-1", { maxRequests: 5, windowMs: 3600000 });
    expect(result.allowed).toBe(false);
    // The oldest request was at time 0, so it expires at 3600000
    // Current time is 1000, so retryAfterMs should be ~3599000
    expect(result.retryAfterMs).toBeLessThanOrEqual(3600000);
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(3598000);
  });
});
