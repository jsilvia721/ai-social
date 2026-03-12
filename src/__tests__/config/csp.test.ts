/**
 * Tests for Content Security Policy headers in next.config.ts
 */

// We need to test the CSP header generation from next.config.ts.
// Since next.config.ts exports a NextConfig object with an async headers() function,
// we can import it and call headers() directly.

describe("CSP headers", () => {
  let cspValue: string;

  beforeAll(async () => {
    // Import the config and extract CSP header
    const { default: nextConfig } = await import("../../../next.config");
    const headerGroups = await nextConfig.headers!();
    const globalHeaders = headerGroups.find(
      (group) => group.source === "/(.*)"
    );
    const cspHeader = globalHeaders?.headers.find(
      (h) => h.key === "Content-Security-Policy"
    );
    cspValue = cspHeader?.value ?? "";
  });

  it("should have a CSP header defined", () => {
    expect(cspValue).toBeTruthy();
  });

  it("should include 'self' in connect-src", () => {
    const connectSrc = extractDirective(cspValue, "connect-src");
    expect(connectSrc).toContain("'self'");
  });

  it("should allow S3 presigned upload domains in connect-src", () => {
    const connectSrc = extractDirective(cspValue, "connect-src");
    // Must allow S3 regional and legacy URL patterns
    expect(connectSrc).toContain("https://*.s3.us-east-1.amazonaws.com");
    expect(connectSrc).toContain("https://*.s3.amazonaws.com");
  });

  it("should allow CloudFront domains in connect-src", () => {
    const connectSrc = extractDirective(cspValue, "connect-src");
    expect(connectSrc).toContain("https://*.cloudfront.net");
  });

  it("should NOT use wildcard * in connect-src", () => {
    const connectSrc = extractDirective(cspValue, "connect-src");
    // Should not have a bare wildcard (allowing all origins)
    const tokens = connectSrc.split(/\s+/);
    expect(tokens).not.toContain("*");
  });

  it("should not modify other CSP directives", () => {
    expect(cspValue).toContain("default-src 'self'");
    expect(cspValue).toContain("frame-ancestors 'none'");
  });
});

describe("CSP connect-src with AWS_S3_PUBLIC_URL", () => {
  const originalEnv = process.env.AWS_S3_PUBLIC_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AWS_S3_PUBLIC_URL = originalEnv;
    } else {
      delete process.env.AWS_S3_PUBLIC_URL;
    }
    // Clear module cache so next.config.ts re-evaluates
    jest.resetModules();
  });

  it("should include specific bucket hostname when AWS_S3_PUBLIC_URL is set", async () => {
    process.env.AWS_S3_PUBLIC_URL = "https://my-bucket.s3.us-east-1.amazonaws.com";
    const { default: config } = await import("../../../next.config");
    const headerGroups = await config.headers!();
    const csp = headerGroups[0].headers.find(
      (h) => h.key === "Content-Security-Policy"
    )?.value ?? "";
    const connectSrc = extractDirective(csp, "connect-src");
    expect(connectSrc).toContain("https://my-bucket.s3.us-east-1.amazonaws.com");
  });

  it("should still include wildcard patterns even when specific URL is set", async () => {
    process.env.AWS_S3_PUBLIC_URL = "https://my-bucket.s3.us-east-1.amazonaws.com";
    const { default: config } = await import("../../../next.config");
    const headerGroups = await config.headers!();
    const csp = headerGroups[0].headers.find(
      (h) => h.key === "Content-Security-Policy"
    )?.value ?? "";
    const connectSrc = extractDirective(csp, "connect-src");
    expect(connectSrc).toContain("https://*.s3.us-east-1.amazonaws.com");
    expect(connectSrc).toContain("https://*.s3.amazonaws.com");
  });
});

/**
 * Extract the value of a specific CSP directive from the full CSP string
 */
function extractDirective(csp: string, directive: string): string {
  const directives = csp.split(";").map((d) => d.trim());
  const match = directives.find((d) => d.startsWith(directive));
  return match ?? "";
}
