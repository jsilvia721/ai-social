import { BlotatoApiError, BlotatoRateLimitError, blotatoFetch } from "@/lib/blotato/client";
import { z } from "zod";

const ResponseSchema = z.object({ id: z.string(), url: z.string() });

describe("blotatoFetch", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    jest.useRealTimers();
  });

  it("returns validated data on success", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ id: "post-1", url: "https://example.com/post-1" }),
    } as Response);

    const result = await blotatoFetch("/posts", ResponseSchema, { method: "GET" });
    expect(result).toEqual({ id: "post-1", url: "https://example.com/post-1" });
  });

  it("sends Authorization Bearer header with api key", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ id: "x", url: "y" }),
    } as Response);

    await blotatoFetch("/test", ResponseSchema);

    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["Authorization"]).toBe(
      `Bearer ${process.env.BLOTATO_API_KEY}`
    );
  });

  it("calls the correct base URL", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ id: "x", url: "y" }),
    } as Response);

    await blotatoFetch("/some/path", ResponseSchema);

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.blotato.com/v1/some/path");
  });

  it("throws BlotatoApiError on non-ok response", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: async () => "Internal Server Error",
    } as Response);

    await expect(blotatoFetch("/posts", ResponseSchema)).rejects.toThrow(BlotatoApiError);
  });

  it("BlotatoApiError carries status code", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers(),
      text: async () => "Service Unavailable",
    } as Response);

    const err = await blotatoFetch("/posts", ResponseSchema).catch((e) => e as BlotatoApiError);
    expect(err.status).toBe(503);
  });

  it("throws BlotatoRateLimitError on 429 with retryAfterMs from header", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "30" }),
      text: async () => "Rate limited",
    } as Response);

    const err = await blotatoFetch("/posts", ResponseSchema).catch((e) => e as BlotatoRateLimitError);
    expect(err).toBeInstanceOf(BlotatoRateLimitError);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(30_000);
  });

  it("BlotatoRateLimitError defaults to 60s when Retry-After header is absent", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers(),
      text: async () => "Rate limited",
    } as Response);

    const err = await blotatoFetch("/posts", ResponseSchema).catch((e) => e as BlotatoRateLimitError);
    expect(err.retryAfterMs).toBe(60_000);
  });

  it("throws BlotatoApiError on Zod validation failure", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ unexpected: "shape" }),
    } as Response);

    const err = await blotatoFetch("/posts", ResponseSchema).catch((e) => e as BlotatoApiError);
    expect(err).toBeInstanceOf(BlotatoApiError);
    expect(err.message).toContain("Unexpected response shape");
  });

  it("BlotatoRateLimitError is instanceof BlotatoApiError", () => {
    const err = new BlotatoRateLimitError(5000);
    expect(err).toBeInstanceOf(BlotatoRateLimitError);
    expect(err).toBeInstanceOf(BlotatoApiError);
    expect(err).toBeInstanceOf(Error);
  });

  it("throws BlotatoApiError with timeout status on request abort", async () => {
    fetchSpy.mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));

    const err = await blotatoFetch("/posts", ResponseSchema).catch((e) => e as BlotatoApiError);
    expect(err).toBeInstanceOf(BlotatoApiError);
    expect(err.status).toBe(408);
    expect(err.message).toContain("timed out");
  });

  it("re-throws non-abort network errors as-is", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(blotatoFetch("/posts", ResponseSchema)).rejects.toThrow(TypeError);
  });
});

describe("BlotatoApiError", () => {
  it("instanceof check works correctly (setPrototypeOf applied)", () => {
    const err = new BlotatoApiError("test", 500);
    expect(err instanceof BlotatoApiError).toBe(true);
    expect(err instanceof Error).toBe(true);
    expect(err.name).toBe("BlotatoApiError");
  });
});

describe("assertSafeMediaUrl (SSRF guard)", () => {
  // Import here so the test file is the source of truth for the guard
  const { assertSafeMediaUrl } = require("@/lib/blotato/ssrf-guard");

  it("allows URLs starting with the configured S3 prefix + slash", () => {
    expect(() =>
      assertSafeMediaUrl("https://storage.example.com/uploads/img.jpg")
    ).not.toThrow();
  });

  it("rejects a subdomain bypass: storage.example.com.evil.com", () => {
    expect(() =>
      assertSafeMediaUrl("https://storage.example.com.evil.com/img.jpg")
    ).toThrow("SSRF guard");
  });

  it("rejects a URL that doesn't start with the S3 prefix", () => {
    expect(() =>
      assertSafeMediaUrl("https://evil.com/img.jpg")
    ).toThrow("SSRF guard");
  });

  it("rejects the S3 base URL without a trailing slash path component", () => {
    // https://storage.example.com (no slash) should NOT be allowed to bypass
    // by matching with the base URL itself missing the path separator
    expect(() =>
      assertSafeMediaUrl("https://storage.example.com")
    ).toThrow("SSRF guard");
  });
});
