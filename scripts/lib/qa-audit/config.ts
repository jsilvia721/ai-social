/**
 * QA/UX Audit — types, route manifest, viewport config, prompt template
 */
import { z } from "zod";

// ── Viewport Configuration ──────────────────────────────────────────────────

export interface ViewportConfig {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export const VIEWPORTS: ViewportConfig[] = [
  { name: "mobile", width: 375, height: 812, deviceScaleFactor: 2 },
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
];

// ── Route Manifest ──────────────────────────────────────────────────────────

export interface RouteEntry {
  path: string;
  label: string;
  /** Dynamic param substitution: key is placeholder, value resolved at runtime */
  dynamicParams?: Record<string, string>;
  suggestedFiles: string[];
}

/**
 * All dashboard routes to audit (excludes /dashboard/dev-tools).
 * Dynamic segments ([id], [groupId]) resolved at runtime via Prisma.
 */
export const ROUTE_MANIFEST: RouteEntry[] = [
  {
    path: "/dashboard",
    label: "Dashboard Home",
    suggestedFiles: ["src/app/dashboard/page.tsx"],
  },
  {
    path: "/dashboard/accounts",
    label: "Accounts",
    suggestedFiles: ["src/app/dashboard/accounts/page.tsx"],
  },
  {
    path: "/dashboard/analytics",
    label: "Analytics",
    suggestedFiles: ["src/app/dashboard/analytics/page.tsx"],
  },
  {
    path: "/dashboard/briefs",
    label: "Content Briefs",
    suggestedFiles: ["src/app/dashboard/briefs/page.tsx"],
  },
  {
    path: "/dashboard/businesses",
    label: "Businesses",
    suggestedFiles: ["src/app/dashboard/businesses/page.tsx"],
  },
  {
    path: "/dashboard/businesses/new",
    label: "New Business",
    suggestedFiles: ["src/app/dashboard/businesses/new/page.tsx"],
  },
  {
    path: "/dashboard/businesses/[id]/onboard",
    label: "Business Onboarding",
    dynamicParams: { id: "businessId" },
    suggestedFiles: ["src/app/dashboard/businesses/[id]/onboard/page.tsx"],
  },
  {
    path: "/dashboard/insights",
    label: "Strategy Insights",
    suggestedFiles: ["src/app/dashboard/insights/page.tsx"],
  },
  {
    path: "/dashboard/posts",
    label: "Posts",
    suggestedFiles: ["src/app/dashboard/posts/page.tsx"],
  },
  {
    path: "/dashboard/posts/new",
    label: "New Post",
    suggestedFiles: ["src/app/dashboard/posts/new/page.tsx"],
  },
  {
    path: "/dashboard/posts/[id]/edit",
    label: "Edit Post",
    dynamicParams: { id: "postId" },
    suggestedFiles: ["src/app/dashboard/posts/[id]/edit/page.tsx"],
  },
  {
    path: "/dashboard/posts/repurpose/[groupId]",
    label: "Repurpose Post",
    dynamicParams: { groupId: "repurposeGroupId" },
    suggestedFiles: [
      "src/app/dashboard/posts/repurpose/[groupId]/page.tsx",
    ],
  },
  {
    path: "/dashboard/review",
    label: "Review Queue",
    suggestedFiles: ["src/app/dashboard/review/page.tsx"],
  },
  {
    path: "/dashboard/strategy",
    label: "Strategy",
    suggestedFiles: ["src/app/dashboard/strategy/page.tsx"],
  },
];

// ── Finding Schema ──────────────────────────────────────────────────────────

export const FindingSeverity = z.enum(["critical", "major", "minor", "cosmetic"]);
export type FindingSeverity = z.infer<typeof FindingSeverity>;

export const FindingComplexity = z.enum(["simple", "complex"]);
export type FindingComplexity = z.infer<typeof FindingComplexity>;

export const FindingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  severity: FindingSeverity,
  confidence: z.number().min(0).max(1),
  complexity: FindingComplexity,
  viewport: z.enum(["mobile", "desktop", "both"]),
  element: z.string().optional(),
});

export type Finding = z.infer<typeof FindingSchema>;

export const FindingsResponseSchema = z.object({
  findings: z.array(FindingSchema),
  overallScore: z.number().min(0).max(100),
  summary: z.string(),
});

export type FindingsResponse = z.infer<typeof FindingsResponseSchema>;

// ── Tool Definition (for Claude forced tool choice) ─────────────────────────

export const REPORT_UI_FINDINGS_TOOL = {
  name: "report_ui_findings" as const,
  description:
    "Report UI/UX findings from analyzing screenshots of a web application page.",
  input_schema: {
    type: "object" as const,
    properties: {
      findings: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            title: { type: "string" as const, description: "Short title for the finding" },
            description: {
              type: "string" as const,
              description: "Detailed description of the issue and how to fix it",
            },
            severity: {
              type: "string" as const,
              enum: ["critical", "major", "minor", "cosmetic"],
            },
            confidence: {
              type: "number" as const,
              description: "How confident you are this is a real issue (0.0-1.0)",
              minimum: 0,
              maximum: 1,
            },
            complexity: {
              type: "string" as const,
              enum: ["simple", "complex"],
              description: "simple = CSS/text fix in 1-2 files; complex = logic/architecture change",
            },
            viewport: {
              type: "string" as const,
              enum: ["mobile", "desktop", "both"],
              description: "Which viewport(s) the issue appears in",
            },
            element: {
              type: "string" as const,
              description: "CSS selector or description of the affected element (optional)",
            },
          },
          required: ["title", "description", "severity", "confidence", "complexity", "viewport"],
        },
      },
      overallScore: {
        type: "number" as const,
        description: "Overall quality score 0-100",
        minimum: 0,
        maximum: 100,
      },
      summary: {
        type: "string" as const,
        description: "Brief overall assessment of the page's UI/UX quality",
      },
    },
    required: ["findings", "overallScore", "summary"],
  },
};

// ── Prompt Template ─────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are a senior QA engineer and UX expert reviewing screenshots of a Next.js dashboard application.
The app uses Tailwind CSS v4, shadcn/ui components, and a dark color scheme.

Analyze the provided mobile and desktop screenshots and report any UI/UX issues you find.

Focus on:
- Layout issues (overflow, truncation, misalignment, overlapping elements)
- Responsive design problems (content not adapting properly between mobile/desktop)
- Accessibility concerns (contrast, touch targets, missing labels)
- Visual polish (inconsistent spacing, broken borders, loading state artifacts)
- UX problems (confusing navigation, hidden actions, unclear states)
- Empty states (missing helpful messages when no data exists)

Do NOT report:
- Missing or placeholder content (seed data may be limited)
- Issues that require authentication context (assumed logged in)
- Browser-specific rendering (assume modern Chrome)
- Performance issues (this is a visual audit only)

Rate your confidence for each finding. Only report issues you are fairly confident about (>= 0.5).
Classify each as "simple" (CSS/copy fix, 1-2 files) or "complex" (logic/architecture change).`;

export function buildUserPrompt(route: RouteEntry, resolvedPath: string): string {
  return `Please analyze these screenshots of the "${route.label}" page (${resolvedPath}).

The first image is the mobile view (375px wide) and the second is the desktop view (1440px wide).

Report all UI/UX issues you find using the report_ui_findings tool.`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function sanitizeSlug(path: string): string {
  return path.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function generateFingerprint(route: string, findingTitle: string): string {
  const normalized = `${route}::${findingTitle}`.toLowerCase().replace(/\s+/g, "-");
  // Simple hash for dedup — not cryptographic
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Use unsigned right shift to avoid Math.abs(-2147483648) returning negative
  return `qa-${(hash >>> 0).toString(36)}`;
}

export function getLabelsForFinding(finding: Finding): string[] {
  const labels = ["qa-audit", "needs-triage"];
  if (finding.complexity === "simple") {
    labels.push("simple-fix");
  } else {
    labels.push("needs-plan");
  }
  return labels;
}

// ── Issue Body Builder ──────────────────────────────────────────────────────

export interface IssueBodyParams {
  finding: Finding;
  route: RouteEntry;
  resolvedPath: string;
  fingerprint: string;
  screenshotUrls: { mobile?: string; desktop?: string };
}

export function buildIssueBody(params: IssueBodyParams): string {
  const { finding, route, resolvedPath, fingerprint, screenshotUrls } = params;

  const screenshotSection = [
    screenshotUrls.mobile && `**Mobile (375px):**\n![mobile](${screenshotUrls.mobile})`,
    screenshotUrls.desktop && `**Desktop (1440px):**\n![desktop](${screenshotUrls.desktop})`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const suggestedFiles = route.suggestedFiles.map((f) => `- \`${f}\``).join("\n");

  const metadata = JSON.stringify({
    fingerprint,
    route: resolvedPath,
    severity: finding.severity,
    confidence: finding.confidence,
    complexity: finding.complexity,
    viewport: finding.viewport,
  });

  return `**Fingerprint:** \`${fingerprint}\`

## Finding

**Severity:** ${finding.severity}
**Confidence:** ${(finding.confidence * 100).toFixed(0)}%
**Viewport:** ${finding.viewport}
**Page:** ${route.label} (\`${resolvedPath}\`)

${finding.description}

## Screenshot

${screenshotSection || "_No screenshots available (dry-run)_"}

## Suggested Files

${suggestedFiles}

## Complexity

${finding.complexity === "simple" ? "**Simple fix** — likely a CSS or copy change in 1-2 files." : "**Complex fix** — may require logic or architectural changes."}

<!-- qa-finding: ${metadata} -->

---
_Generated by QA/UX audit script_`;
}

// ── CLI Options ─────────────────────────────────────────────────────────────

export interface AuditOptions {
  dryRun: boolean;
  output: "text" | "json";
  baseUrl: string;
  verbose: boolean;
}

