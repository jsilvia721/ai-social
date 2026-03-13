#!/usr/bin/env npx tsx
/**
 * QA/UX Audit CLI — crawls dashboard pages, analyzes with Claude vision,
 * creates GitHub issues per finding.
 *
 * Usage:
 *   npm run qa:audit                         # full audit
 *   npm run qa:audit -- --dry-run            # skip external calls, save locally
 *   npm run qa:audit -- --output json        # output full report as JSON
 *   npm run qa:audit -- --base-url <url>     # custom base URL
 *   npm run qa:audit -- --verbose            # detailed logging
 */

import { parseArgs } from "node:util";
import { runQaAudit } from "./lib/qa-audit/audit";
import type { AuditOptions } from "./lib/qa-audit/config";

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    output: { type: "string", default: "text" },
    "base-url": { type: "string", default: "http://localhost:3000" },
    verbose: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
QA/UX Audit — Crawl dashboard pages and analyze with Claude vision.

Options:
  --dry-run          Skip S3 upload, Claude API, and GitHub issue creation.
                     Saves screenshots to tmp/qa-audit/.
  --output <format>  Output format: "text" (default) or "json".
  --base-url <url>   Base URL of the app (default: http://localhost:3000).
  --verbose          Enable detailed logging.
  --help             Show this help message.

Prerequisites:
  Dev server must be running with PLAYWRIGHT_E2E=true for auth to work.
  ANTHROPIC_API_KEY must be set (not required for --dry-run).
`);
  process.exit(0);
}

const outputRaw = values.output ?? "text";
if (outputRaw !== "text" && outputRaw !== "json") {
  console.error(`Invalid output format: ${outputRaw}. Must be "text" or "json".`);
  process.exit(1);
}
const output: "text" | "json" = outputRaw;

const options: AuditOptions = {
  dryRun: values["dry-run"] ?? false,
  output,
  baseUrl: values["base-url"] ?? "http://localhost:3000",
  verbose: values.verbose ?? false,
};

console.log("🔍 QA/UX Audit");
console.log(`   Mode: ${options.dryRun ? "dry-run" : "live"}`);
console.log(`   Base URL: ${options.baseUrl}`);
console.log(`   Output: ${options.output}`);
console.log("");

runQaAudit(options)
  .then((report) => {
    const total = report.results.length;
    const errors = report.results.filter((r) => r.error).length;
    console.log(`\n✅ Audit complete: ${total} pages crawled, ${errors} errors`);
    if (report.issuesCreated.length > 0) {
      console.log(`   ${report.issuesCreated.length} issues created`);
    }
    if (report.indexIssueUrl) {
      console.log(`   Index: ${report.indexIssueUrl}`);
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Audit failed:", err);
    process.exit(1);
  });
