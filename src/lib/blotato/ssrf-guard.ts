import { env } from "@/env";

/**
 * Validates that a media URL originates from our own S3 storage bucket.
 * The trailing-slash check prevents a subdomain bypass where
 * https://storage.example.com.evil.com/ would pass a bare startsWith check.
 */
export function assertSafeMediaUrl(url: string): void {
  const base = env.AWS_S3_PUBLIC_URL;
  if (!base) {
    throw new Error("SSRF guard: AWS_S3_PUBLIC_URL is not configured");
  }
  const allowedPrefix = base.endsWith("/") ? base : `${base}/`;
  if (!url.startsWith(allowedPrefix)) {
    throw new Error(
      `SSRF guard: mediaUrl must start with ${allowedPrefix}. Got: ${url}`,
    );
  }
}
