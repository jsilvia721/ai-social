/**
 * Tests for Content Security Policy headers in next.config.ts
 *
 * The test setup (setup.ts) sets AWS_S3_PUBLIC_URL="https://storage.example.com",
 * so the default test environment simulates production where the specific bucket
 * hostname is known.
 */

async function loadCsp(): Promise<string> {
  const { default: config } = await import("../../../next.config");
  const headerGroups = await config.headers!();
  const csp =
    headerGroups[0].headers.find((h) => h.key === "Content-Security-Policy")
      ?.value ?? "";
  return csp;
}

/**
 * Extract the value of a specific CSP directive from the full CSP string
 */
function extractDirective(csp: string, directive: string): string {
  const directives = csp.split(";").map((d) => d.trim());
  const match = directives.find((d) => d.startsWith(directive));
  return match ?? "";
}

describe("CSP headers (common)", () => {
  let cspValue: string;

  beforeAll(async () => {
    cspValue = await loadCsp();
  });

  it("should have a CSP header defined", () => {
    expect(cspValue).toBeTruthy();
  });

  it("should include 'self' in connect-src", () => {
    const connectSrc = extractDirective(cspValue, "connect-src");
    expect(connectSrc).toContain("'self'");
  });

  it("should allow CloudFront domains in connect-src", () => {
    const connectSrc = extractDirective(cspValue, "connect-src");
    expect(connectSrc).toContain("https://*.cloudfront.net");
  });

  it("should NOT use bare wildcard * in connect-src", () => {
    const connectSrc = extractDirective(cspValue, "connect-src");
    const tokens = connectSrc.split(/\s+/);
    expect(tokens).not.toContain("*");
  });

  it("should not modify other CSP directives", () => {
    expect(cspValue).toContain("default-src 'self'");
    expect(cspValue).toContain("frame-ancestors 'none'");
  });

  it("should include media-src directive allowing self and https", () => {
    const mediaSrc = extractDirective(cspValue, "media-src");
    expect(mediaSrc).toBe("media-src 'self' https:");
  });
});

describe("CSP connect-src with AWS_S3_PUBLIC_URL set (production)", () => {
  const originalEnv = process.env.AWS_S3_PUBLIC_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AWS_S3_PUBLIC_URL = originalEnv;
    } else {
      delete process.env.AWS_S3_PUBLIC_URL;
    }
    jest.resetModules();
  });

  it("should include specific bucket hostname", async () => {
    process.env.AWS_S3_PUBLIC_URL =
      "https://my-bucket.s3.us-east-1.amazonaws.com";
    const csp = await loadCsp();
    const connectSrc = extractDirective(csp, "connect-src");
    expect(connectSrc).toContain(
      "https://my-bucket.s3.us-east-1.amazonaws.com"
    );
  });

  it("should omit S3 wildcard patterns when specific URL is set", async () => {
    process.env.AWS_S3_PUBLIC_URL =
      "https://my-bucket.s3.us-east-1.amazonaws.com";
    const csp = await loadCsp();
    const connectSrc = extractDirective(csp, "connect-src");
    expect(connectSrc).not.toContain("https://*.s3.us-east-1.amazonaws.com");
    expect(connectSrc).not.toContain("https://*.s3.amazonaws.com");
  });

  it("should include regional S3 hostname when non-regional URL is set", async () => {
    process.env.AWS_S3_PUBLIC_URL =
      "https://my-bucket.s3.amazonaws.com";
    const csp = await loadCsp();
    const connectSrc = extractDirective(csp, "connect-src");
    // Should allow both non-regional and regional hostnames
    expect(connectSrc).toContain("https://my-bucket.s3.amazonaws.com");
    expect(connectSrc).toContain("https://my-bucket.s3.us-east-1.amazonaws.com");
  });

  it("should include non-regional S3 hostname when regional URL is set", async () => {
    process.env.AWS_S3_PUBLIC_URL =
      "https://my-bucket.s3.us-east-1.amazonaws.com";
    const csp = await loadCsp();
    const connectSrc = extractDirective(csp, "connect-src");
    // Should allow both regional and non-regional hostnames
    expect(connectSrc).toContain("https://my-bucket.s3.us-east-1.amazonaws.com");
    expect(connectSrc).toContain("https://my-bucket.s3.amazonaws.com");
  });
});

describe("CSP connect-src without AWS_S3_PUBLIC_URL (local dev)", () => {
  const originalEnv = process.env.AWS_S3_PUBLIC_URL;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.AWS_S3_PUBLIC_URL = originalEnv;
    } else {
      delete process.env.AWS_S3_PUBLIC_URL;
    }
    jest.resetModules();
  });

  it("should fall back to S3 wildcard patterns", async () => {
    delete process.env.AWS_S3_PUBLIC_URL;
    const csp = await loadCsp();
    const connectSrc = extractDirective(csp, "connect-src");
    expect(connectSrc).toContain("https://*.s3.us-east-1.amazonaws.com");
    expect(connectSrc).toContain("https://*.s3.amazonaws.com");
  });
});
