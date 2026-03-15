import { z } from "zod";
import { env } from "@/env";
import { trackApiCall } from "@/lib/system-metrics";

const BASE = "https://backend.blotato.com/v2";
const TIMEOUT_MS = 15_000;

export class BlotatoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "BlotatoApiError";
    // Required for correct instanceof checks in TypeScript/CommonJS
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BlotatoRateLimitError extends BlotatoApiError {
  constructor(public readonly retryAfterMs: number) {
    super("Rate limited by Blotato", 429);
    this.name = "BlotatoRateLimitError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Duck-type check for BlotatoApiError that works even when prototype chains
 * are broken in bundled environments (e.g., SST/Lambda esbuild).
 *
 * Note: the duck-type branch narrows to BlotatoApiError structurally;
 * the object may not be a true instance.
 */
export function isBlotatoApiError(err: unknown): err is BlotatoApiError {
  if (err instanceof BlotatoApiError) return true;
  if (
    err instanceof Error &&
    err.name === "BlotatoApiError" &&
    "status" in err &&
    typeof (err as Record<string, unknown>).status === "number"
  ) {
    console.warn("[blotato] isBlotatoApiError matched via duck-type fallback (instanceof failed)");
    return true;
  }
  return false;
}

export async function blotatoFetch<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  options: RequestInit = {},
): Promise<z.infer<S>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startMs = Date.now();

  let res: Response | undefined;
  let errorMessage: string | undefined;
  try {
    try {
      res = await fetch(`${BASE}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "blotato-api-key": env.BLOTATO_API_KEY,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        const timeoutErr = new BlotatoApiError("Request timed out", 408);
        errorMessage = timeoutErr.message;
        throw timeoutErr;
      }
      errorMessage = (err as Error).message;
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? 60);
      const rateLimitErr = new BlotatoRateLimitError(retryAfter * 1000);
      errorMessage = rateLimitErr.message;
      throw rateLimitErr;
    }

    if (!res.ok) {
      const body = await res.text();
      const apiErr = new BlotatoApiError(`Blotato API error ${res.status}: ${body}`, res.status);
      errorMessage = apiErr.message;
      throw apiErr;
    }

    const data: unknown = await res.json();
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      const parseErr = new BlotatoApiError(
        `Unexpected response shape: ${parsed.error.issues[0]?.message}`,
        200,
      );
      errorMessage = parseErr.message;
      throw parseErr;
    }
    return parsed.data;
  } finally {
    trackApiCall({
      service: "blotato",
      endpoint: path,
      method: options.method ?? "GET",
      statusCode: res?.status,
      latencyMs: Date.now() - startMs,
      error: errorMessage,
    });
  }
}
