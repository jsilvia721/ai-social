/**
 * Central config for external API mocking.
 *
 * When MOCK_EXTERNAL_APIS=true (the default for non-production),
 * all paid external API calls return realistic mock data instead of
 * hitting real endpoints. This prevents cost from Anthropic, Blotato,
 * SerpAPI, and social platform APIs during development and staging.
 *
 * AWS services (S3, SES, EventBridge) and the database are NOT mocked.
 *
 * Runtime override: In development, POST /api/dev/mock-mode toggles
 * mock mode via a tmp file flag, persists across module re-evaluations.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const OVERRIDE_FILE = join(process.cwd(), ".next", "mock-override.json");

function readOverride(): boolean | null {
  // Only read file override in actual development (not in tests or production)
  if (process.env.NODE_ENV !== "development" || process.env.JEST_WORKER_ID) return null;
  try {
    if (!existsSync(OVERRIDE_FILE)) return null;
    const raw = readFileSync(OVERRIDE_FILE, "utf8");
    const data = JSON.parse(raw);
    return typeof data.mock === "boolean" ? data.mock : null;
  } catch {
    return null;
  }
}

export function shouldMockExternalApis(): boolean {
  // Runtime toggle takes priority (dev only)
  const override = readOverride();
  if (override !== null) return override;

  // Explicit env var takes priority
  if (process.env.MOCK_EXTERNAL_APIS === "true") return true;
  if (process.env.MOCK_EXTERNAL_APIS === "false") return false;

  // Default: mock in development and test, live in production
  return process.env.NODE_ENV !== "production";
}

/** Toggle mock mode at runtime (dev only). Returns the new state. */
export function setMockOverride(mock: boolean | null): boolean {
  if (process.env.NODE_ENV === "production") return shouldMockExternalApis();
  try {
    if (mock === null) {
      if (existsSync(OVERRIDE_FILE)) unlinkSync(OVERRIDE_FILE);
    } else {
      writeFileSync(OVERRIDE_FILE, JSON.stringify({ mock }), "utf8");
    }
  } catch {
    // ignore — .next dir may not exist yet
  }
  return shouldMockExternalApis();
}

/** Get current override value (null = using env/default). */
export function getMockOverride(): boolean | null {
  return readOverride();
}
