import { env } from "@/env";

/**
 * Validates that a media URL originates from our own S3 storage bucket.
 * Rejects any URL that doesn't start with the configured public S3 prefix,
 * preventing SSRF attacks where a malicious URL stored in the database
 * could cause the server (or a third-party API) to fetch internal endpoints
 * such as AWS instance metadata (http://169.254.169.254/...).
 */
export function assertSafeMediaUrl(url: string): void {
  const allowedPrefix = env.AWS_S3_PUBLIC_URL;
  if (!url.startsWith(allowedPrefix)) {
    throw new Error(
      `SSRF guard: mediaUrl must be an S3 URL starting with ${allowedPrefix}. Got: ${url}`
    );
  }
}
