import { z } from "zod";
import { env } from "@/env";

const BASE = "https://api.blotato.com/v1";
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

export async function blotatoFetch<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.BLOTATO_API_KEY}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new BlotatoApiError("Request timed out", 408);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") ?? 60);
    throw new BlotatoRateLimitError(retryAfter * 1000);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new BlotatoApiError(`Blotato API error ${res.status}: ${body}`, res.status);
  }

  const data: unknown = await res.json();
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new BlotatoApiError(
      `Unexpected response shape: ${parsed.error.issues[0]?.message}`,
      200,
    );
  }
  return parsed.data;
}
