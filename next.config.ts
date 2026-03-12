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

      // AWS S3 presigned URLs may use either regional
      // (bucket.s3.us-east-1.amazonaws.com) or non-regional
      // (bucket.s3.amazonaws.com) hostnames. Allow both variants so
      // browser uploads via presigned URLs aren't blocked by CSP.
      const regionalMatch = hostname.match(
        /^(.+)\.s3\.([a-z0-9-]+)\.amazonaws\.com$/
      );
      const nonRegionalMatch = hostname.match(
        /^(.+)\.s3\.amazonaws\.com$/
      );
      if (regionalMatch) {
        // Also allow the non-regional variant
        sources.push(`https://${regionalMatch[1]}.s3.amazonaws.com`);
      } else if (nonRegionalMatch) {
        // Also allow the regional variant (us-east-1 is the default)
        sources.push(
          `https://${nonRegionalMatch[1]}.s3.us-east-1.amazonaws.com`
        );
      }
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
