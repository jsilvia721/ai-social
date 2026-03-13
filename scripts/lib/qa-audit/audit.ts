/**
 * QA/UX Audit — core logic: crawl pages, analyze screenshots, create issues.
 *
 * Exported `runQaAudit(options)` is the main entry point.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import Anthropic from "@anthropic-ai/sdk";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import sharp from "sharp";

import {
  type AuditOptions,
  type Finding,
  type FindingsResponse,
  type RouteEntry,
  type ViewportConfig,
  VIEWPORTS,
  ROUTE_MANIFEST,
  SYSTEM_PROMPT,
  REPORT_UI_FINDINGS_TOOL,
  FindingsResponseSchema,
  buildUserPrompt,
  sanitizeSlug,
  generateFingerprint,
  getLabelsForFinding,
  buildIssueBody,
} from "./config";

// ── Types ───────────────────────────────────────────────────────────────────

interface PageResult {
  route: RouteEntry;
  resolvedPath: string;
  screenshots: Map<string, Buffer>; // viewport name -> resized JPEG buffer
  analysis?: FindingsResponse;
  screenshotUrls: Map<string, string>; // viewport name -> S3 URL or local path
  error?: string;
}

interface AuditReport {
  results: PageResult[];
  issuesCreated: string[];
  indexIssueUrl?: string;
}

// ── Standalone S3 Helper ────────────────────────────────────────────────────
// Deliberately NOT importing from src/lib/storage.ts to avoid env.ts validation.

function createS3Client(): S3Client {
  return new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
}

async function uploadToS3(
  s3: S3Client,
  buffer: Buffer,
  key: string,
  mimeType: string
): Promise<string> {
  const bucket = process.env.AWS_S3_BUCKET;
  const publicBase = process.env.AWS_S3_PUBLIC_URL;
  if (!bucket || !publicBase) {
    throw new Error("AWS_S3_BUCKET and AWS_S3_PUBLIC_URL must be set");
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ContentLength: buffer.byteLength,
    })
  );
  const base = publicBase.endsWith("/") ? publicBase.slice(0, -1) : publicBase;
  return `${base}/${key}`;
}

// ── Browser Helpers ─────────────────────────────────────────────────────────

const DISABLE_ANIMATIONS_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
`;

const LOAD_SELECTORS = ".skeleton, [aria-busy], .loading-spinner";

async function waitForPageReady(page: Page): Promise<void> {
  // Wait for loading indicators to disappear
  try {
    await page.waitForFunction(
      (sel: string) => document.querySelectorAll(sel).length === 0,
      LOAD_SELECTORS,
      { timeout: 10000 }
    );
  } catch {
    // Loading indicators may not exist — that's fine
  }

  // Wait for fonts
  await page.evaluate(() => document.fonts.ready);

  // Settle time for late renders
  await page.waitForTimeout(500);
}

async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const distance = 300;
    const delay = 100;
    while (
      document.documentElement.scrollTop + window.innerHeight <
      document.documentElement.scrollHeight
    ) {
      window.scrollBy(0, distance);
      await new Promise((r) => setTimeout(r, delay));
    }
    // Scroll back to top for screenshot
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
}

async function captureScreenshot(
  browser: Browser,
  url: string,
  viewport: ViewportConfig,
  cookie: { name: string; value: string; domain: string; path: string }
): Promise<Buffer> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    colorScheme: "dark",
  });
  await context.addCookies([cookie]);

  const page = await context.newPage();

  // Inject CSS to disable animations
  await page.addStyleTag({ content: DISABLE_ANIMATIONS_CSS });

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await waitForPageReady(page);
  await scrollToBottom(page);

  const rawBuffer = await page.screenshot({ fullPage: true });
  await context.close();

  // Resize with sharp: max 1024px width, JPEG quality 85
  const resized = await sharp(rawBuffer)
    .resize({ width: 1024, withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  return resized;
}

// ── Auth Helper ─────────────────────────────────────────────────────────────

async function getAuthCookie(
  baseUrl: string
): Promise<{ name: string; value: string; domain: string; path: string }> {
  const url = new URL("/api/test/session?email=test@example.com", baseUrl);
  const resp = await fetch(url.toString(), { redirect: "manual" });
  const setCookie = resp.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("No session cookie returned from test auth endpoint");
  }

  // Parse "next-auth.session-token=<value>; ..."
  const match = setCookie.match(/next-auth\.session-token=([^;]+)/);
  if (!match) {
    throw new Error("Could not parse session token from Set-Cookie header");
  }

  const hostname = new URL(baseUrl).hostname;
  return {
    name: "next-auth.session-token",
    value: match[1],
    domain: hostname,
    path: "/",
  };
}

// ── Dynamic Route Resolution ────────────────────────────────────────────────

async function resolveDynamicParams(): Promise<Record<string, string>> {
  // Lazy import to avoid triggering env.ts validation at module load
  const { prisma } = await import("../../../src/lib/db");

  try {
    const params: Record<string, string> = {};

    // Get first business for [id] routes
    const business = await prisma.business.findFirst({
      orderBy: { createdAt: "desc" },
    });
    if (business) {
      params.businessId = business.id;
    }

    // Get first post for [id] edit route
    const post = await prisma.post.findFirst({
      orderBy: { createdAt: "desc" },
    });
    if (post) {
      params.postId = post.id;
      if (post.repurposeGroupId) {
        params.repurposeGroupId = post.repurposeGroupId;
      }
    }

    // If no repurposeGroupId from a post, try to find any post with one
    if (!params.repurposeGroupId) {
      const repurposePost = await prisma.post.findFirst({
        where: { repurposeGroupId: { not: null } },
        orderBy: { createdAt: "desc" },
      });
      if (repurposePost?.repurposeGroupId) {
        params.repurposeGroupId = repurposePost.repurposeGroupId;
      }
    }

    await prisma.$disconnect();
    return params;
  } catch (err) {
    console.warn("⚠️  Could not resolve dynamic params from database:", err);
    return {};
  }
}

function resolveRoutePath(
  route: RouteEntry,
  params: Record<string, string>
): string | null {
  let path = route.path;
  if (!route.dynamicParams) return path;

  for (const [placeholder, paramKey] of Object.entries(route.dynamicParams)) {
    const value = params[paramKey];
    if (!value) return null; // Can't resolve — skip route
    path = path.replace(`[${placeholder}]`, value);
  }
  return path;
}

// ── Claude Vision Analysis ──────────────────────────────────────────────────

async function analyzeScreenshots(
  mobileBuffer: Buffer,
  desktopBuffer: Buffer,
  route: RouteEntry,
  resolvedPath: string
): Promise<FindingsResponse> {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [REPORT_UI_FINDINGS_TOOL],
    tool_choice: { type: "tool", name: "report_ui_findings" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: mobileBuffer.toString("base64"),
            },
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: desktopBuffer.toString("base64"),
            },
          },
          {
            type: "text",
            text: buildUserPrompt(route, resolvedPath),
          },
        ],
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not call report_ui_findings");
  }

  return FindingsResponseSchema.parse(toolUse.input);
}

// ── GitHub Issue Management ─────────────────────────────────────────────────

function checkExistingIssue(fingerprint: string): boolean {
  try {
    const result = execFileSync("gh", [
      "issue",
      "list",
      "--label",
      "qa-audit",
      "--search",
      fingerprint,
      "--json",
      "number",
      "--limit",
      "1",
    ], { encoding: "utf8" });
    const issues = JSON.parse(result);
    return issues.length > 0;
  } catch {
    return false;
  }
}

function createGitHubIssue(
  title: string,
  body: string,
  labels: string[]
): string | null {
  try {
    const args = [
      "issue",
      "create",
      "--title",
      title,
      "--body",
      body,
      ...labels.flatMap((l) => ["--label", l]),
    ];
    const result = execFileSync("gh", args, { encoding: "utf8" });
    return result.trim();
  } catch (err) {
    console.error("Failed to create issue:", err);
    return null;
  }
}

function createIndexIssue(
  issueUrls: string[],
  resultSummaries: { route: string; score: number; findingCount: number }[]
): string | null {
  const date = new Date().toISOString().split("T")[0];
  const routeRows = resultSummaries
    .map((r) => `| ${r.route} | ${r.score} | ${r.findingCount} |`)
    .join("\n");

  const issueLinks = issueUrls.map((url, i) => `${i + 1}. ${url}`).join("\n");

  const body = `## QA/UX Audit — ${date}

### Route Summary

| Route | Score | Findings |
|-------|-------|----------|
${routeRows}

### Finding Issues

${issueLinks}

---
_Generated by QA/UX audit script_`;

  return createGitHubIssue(`QA/UX Audit — ${date}`, body, ["qa-audit"]);
}

// ── Precondition Checks ─────────────────────────────────────────────────────

async function checkPreconditions(options: AuditOptions): Promise<void> {
  // Check server is reachable
  try {
    const resp = await fetch(options.baseUrl, { method: "HEAD" });
    if (!resp.ok && resp.status !== 405) {
      throw new Error(`Server returned ${resp.status}`);
    }
  } catch (err) {
    throw new Error(
      `Server not reachable at ${options.baseUrl}. Is it running? (${err})`
    );
  }

  if (!options.dryRun) {
    // Check ANTHROPIC_API_KEY
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey === "mock-key") {
      throw new Error(
        "ANTHROPIC_API_KEY must be set and not 'mock-key' for live audit"
      );
    }

    // Check gh auth
    try {
      execFileSync("gh", ["auth", "status"], { encoding: "utf8", stdio: "pipe" });
    } catch {
      throw new Error("GitHub CLI not authenticated. Run 'gh auth login' first.");
    }
  }
}

// ── URL Validation ──────────────────────────────────────────────────────────

function validateNavigationUrl(url: string, baseUrl: string): void {
  const parsed = new URL(url);
  const base = new URL(baseUrl);
  if (parsed.hostname !== base.hostname || parsed.port !== base.port) {
    throw new Error(`Refusing to navigate to non-local URL: ${url}`);
  }
}

// ── Main Audit Function ─────────────────────────────────────────────────────

export async function runQaAudit(options: AuditOptions): Promise<AuditReport> {
  const log = options.verbose
    ? (...args: unknown[]) => console.log(...args)
    : () => {};

  await checkPreconditions(options);

  // Resolve dynamic route params
  log("📦 Resolving dynamic route parameters...");
  const dynamicParams = await resolveDynamicParams();
  log("   Params:", dynamicParams);

  // Build resolved route list
  const routes: { route: RouteEntry; resolvedPath: string }[] = [];
  for (const route of ROUTE_MANIFEST) {
    const resolved = resolveRoutePath(route, dynamicParams);
    if (resolved) {
      routes.push({ route, resolvedPath: resolved });
    } else {
      console.warn(`⚠️  Skipping ${route.path} — missing dynamic param`);
    }
  }

  log(`\n🔍 Auditing ${routes.length} routes...\n`);

  // Launch browser
  const browser = await chromium.launch({ headless: true });
  const cookie = await getAuthCookie(options.baseUrl);

  const s3 = options.dryRun ? null : createS3Client();
  const date = new Date().toISOString().split("T")[0];
  const nonce = randomBytes(4).toString("hex");

  const results: PageResult[] = [];
  const issuesCreated: string[] = [];

  // Process pages — pipeline: capture N+1 while analyzing N
  let pendingAnalysis: Promise<void> | null = null;

  for (let i = 0; i < routes.length; i++) {
    const { route, resolvedPath } = routes[i];
    const slug = sanitizeSlug(resolvedPath);

    console.log(`📸 [${i + 1}/${routes.length}] ${route.label} (${resolvedPath})`);

    const result: PageResult = {
      route,
      resolvedPath,
      screenshots: new Map(),
      screenshotUrls: new Map(),
    };

    try {
      // Capture screenshots for all viewports
      for (const viewport of VIEWPORTS) {
        const url = `${options.baseUrl}${resolvedPath}`;
        validateNavigationUrl(url, options.baseUrl);

        const buffer = await captureScreenshot(browser, url, viewport, cookie);
        result.screenshots.set(viewport.name, buffer);
        log(`   ✅ ${viewport.name} (${viewport.width}px) — ${buffer.byteLength} bytes`);
      }

      // Wait for previous analysis to complete before starting new one
      if (pendingAnalysis) {
        await pendingAnalysis;
        pendingAnalysis = null;
      }

      // Start analysis + upload in parallel
      pendingAnalysis = (async () => {
        try {
          // Upload screenshots (or save locally in dry-run)
          const mobileBuffer = result.screenshots.get("mobile")!;
          const desktopBuffer = result.screenshots.get("desktop")!;

          if (options.dryRun) {
            const dir = `tmp/qa-audit/${date}`;
            mkdirSync(dir, { recursive: true });
            const mobilePath = `${dir}/${slug}-mobile.jpg`;
            const desktopPath = `${dir}/${slug}-desktop.jpg`;
            writeFileSync(mobilePath, mobileBuffer);
            writeFileSync(desktopPath, desktopBuffer);
            result.screenshotUrls.set("mobile", mobilePath);
            result.screenshotUrls.set("desktop", desktopPath);
            log(`   💾 Saved to ${dir}/`);
          } else {
            const [mobileUrl, desktopUrl] = await Promise.all([
              uploadToS3(
                s3!,
                mobileBuffer,
                `screenshots/qa-audit/${date}/${nonce}/${slug}-mobile.jpg`,
                "image/jpeg"
              ),
              uploadToS3(
                s3!,
                desktopBuffer,
                `screenshots/qa-audit/${date}/${nonce}/${slug}-desktop.jpg`,
                "image/jpeg"
              ),
            ]);
            result.screenshotUrls.set("mobile", mobileUrl);
            result.screenshotUrls.set("desktop", desktopUrl);
          }

          // Analyze with Claude (skip in dry-run)
          if (!options.dryRun) {
            const analysis = await analyzeScreenshots(
              mobileBuffer,
              desktopBuffer,
              route,
              resolvedPath
            );
            result.analysis = analysis;
            log(`   🤖 Score: ${analysis.overallScore}/100, ${analysis.findings.length} findings`);
          }

          // Release buffers
          result.screenshots.clear();
        } catch (err) {
          result.error = String(err);
          console.error(`   ❌ Analysis failed: ${err}`);
        }
      })();

      results.push(result);
    } catch (err) {
      result.error = String(err);
      console.error(`   ❌ Screenshot failed: ${err}`);
      results.push(result);
    }
  }

  // Wait for final analysis
  if (pendingAnalysis) {
    await pendingAnalysis;
  }

  await browser.close();

  // ── Create GitHub Issues ────────────────────────────────────────────────

  if (!options.dryRun) {
    console.log("\n📝 Creating GitHub issues...\n");

    for (const result of results) {
      if (!result.analysis) continue;

      const highConfidenceFindings = result.analysis.findings.filter(
        (f) => f.confidence >= 0.7
      );

      for (const finding of highConfidenceFindings) {
        const fingerprint = generateFingerprint(result.resolvedPath, finding.title);

        // Dedup check
        if (checkExistingIssue(fingerprint)) {
          log(`   ⏭️  Skipping duplicate: ${finding.title}`);
          continue;
        }

        const labels = getLabelsForFinding(finding);
        const body = buildIssueBody({
          finding,
          route: result.route,
          resolvedPath: result.resolvedPath,
          fingerprint,
          screenshotUrls: {
            mobile: result.screenshotUrls.get("mobile"),
            desktop: result.screenshotUrls.get("desktop"),
          },
        });

        const issueTitle = `[QA] ${result.route.label}: ${finding.title}`;
        const issueUrl = createGitHubIssue(issueTitle, body, labels);
        if (issueUrl) {
          issuesCreated.push(issueUrl);
          console.log(`   ✅ ${issueTitle}`);
        }
      }
    }

    // Create index issue
    if (issuesCreated.length > 0) {
      const summaries = results
        .filter((r) => r.analysis)
        .map((r) => ({
          route: r.resolvedPath,
          score: r.analysis!.overallScore,
          findingCount: r.analysis!.findings.filter((f) => f.confidence >= 0.7).length,
        }));

      const indexUrl = createIndexIssue(issuesCreated, summaries);
      if (indexUrl) {
        console.log(`\n📋 Index issue: ${indexUrl}`);
      }

      return { results, issuesCreated, indexIssueUrl: indexUrl ?? undefined };
    }
  }

  // ── Output ──────────────────────────────────────────────────────────────

  if (options.output === "json") {
    const report = results.map((r) => ({
      route: r.resolvedPath,
      label: r.route.label,
      analysis: r.analysis ?? null,
      screenshots: Object.fromEntries(r.screenshotUrls),
      error: r.error ?? null,
    }));
    console.log(JSON.stringify(report, null, 2));
  } else if (options.dryRun) {
    console.log("\n📊 Dry-run Summary:\n");
    for (const r of results) {
      const screenshots = Array.from(r.screenshotUrls.values()).join(", ");
      console.log(`  ${r.route.label} (${r.resolvedPath})`);
      console.log(`    Screenshots: ${screenshots || "none"}`);
      if (r.error) console.log(`    Error: ${r.error}`);
    }
  }

  return { results, issuesCreated };
}
