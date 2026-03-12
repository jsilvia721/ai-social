import type { NextConfig } from "next";

function buildConnectSrc(): string {
  const sources = ["'self'"];

  // Try to derive specific bucket hostname from AWS_S3_PUBLIC_URL for a
  // tighter policy in production. Fall back to wildcard S3 patterns in local
  // dev where the env var may be missing.
  const s3PublicUrl = process.env.AWS_S3_PUBLIC_URL;
  let hasSpecificHost = false;
  if (s3PublicUrl) {
    try {
      const hostname = new URL(s3PublicUrl).hostname;
      sources.push(`https://${hostname}`);
      hasSpecificHost = true;
    } catch {
      // Invalid URL — fall through to wildcard patterns
    }
  }

  if (!hasSpecificHost) {
    // Wildcard fallback — presigned URL signatures provide auth so wildcard
    // subdomains are acceptable when the specific hostname is unavailable
    sources.push(
      "https://*.s3.us-east-1.amazonaws.com",
      "https://*.s3.amazonaws.com"
    );
  }

  // CloudFront — SST deploys the app behind CloudFront and some S3 URLs may
  // route through it
  sources.push("https://*.cloudfront.net");

  return `connect-src ${sources.join(" ")}`;
}

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              buildConnectSrc(),
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
