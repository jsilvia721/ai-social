import type { NextConfig } from "next";

function buildConnectSrc(): string {
  const sources = ["'self'"];

  // Try to derive specific bucket hostname from AWS_S3_PUBLIC_URL
  const s3PublicUrl = process.env.AWS_S3_PUBLIC_URL;
  if (s3PublicUrl) {
    try {
      const hostname = new URL(s3PublicUrl).hostname;
      sources.push(`https://${hostname}`);
    } catch {
      // Invalid URL — fall through to wildcard patterns
    }
  }

  // Always include wildcard S3 patterns as fallback (presigned URL signatures
  // provide auth, so wildcard subdomains are safe)
  sources.push(
    "https://*.s3.us-east-1.amazonaws.com",
    "https://*.s3.amazonaws.com",
    "https://*.cloudfront.net"
  );

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
