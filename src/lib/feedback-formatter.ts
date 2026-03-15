/**
 * Classification-aware GitHub issue formatter for feedback submissions.
 *
 * Formats feedback into structured GitHub issues with classification-specific
 * titles, body sections, and labels.
 */

export type FeedbackClassification = "bug" | "feature" | "general";

export interface FormatFeedbackParams {
  classification: FeedbackClassification;
  summary: string;
  userName: string;
  pageUrl?: string;
  screenshotUrl?: string;
}

export interface FormattedIssue {
  title: string;
  body: string;
  labels: string[];
}

/**
 * Truncate text to maxLen on a word boundary, appending "…" if truncated.
 */
export function truncateOnWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace) + "…";
  }
  return truncated + "…";
}

const TITLE_PREFIX: Record<FeedbackClassification, string> = {
  bug: "[Bug] ",
  feature: "[Feature] ",
  general: "[Feedback] ",
};

const LABELS: Record<FeedbackClassification, string[]> = {
  bug: ["bug", "needs-human-review"],
  feature: ["enhancement", "needs-human-review"],
  general: ["needs-human-review"],
};

function buildHeader(params: FormatFeedbackParams): string {
  const lines = [
    `**From:** ${params.userName}`,
    `**Page:** ${params.pageUrl || "Not captured"}`,
    `**Date:** ${new Date().toISOString()}`,
  ];
  return lines.join("\n");
}

function buildScreenshot(screenshotUrl?: string): string {
  if (!screenshotUrl) return "";
  return `\n## Screenshot\n\n![Screenshot](${screenshotUrl})\n`;
}

function buildBugBody(params: FormatFeedbackParams): string {
  return [
    "## Bug Report",
    "",
    buildHeader(params),
    "",
    "---",
    "",
    "## Description",
    "",
    params.summary,
    "",
    "## Steps to Reproduce",
    "",
    "_(Extracted from user conversation)_",
    "",
    "## Expected Behavior",
    "",
    "_(To be determined from context)_",
    "",
    "## Actual Behavior",
    "",
    "_(As described by user)_",
    "",
    buildScreenshot(params.screenshotUrl),
    "---",
    "*Submitted via in-app feedback agent*",
  ].join("\n");
}

function buildFeatureBody(params: FormatFeedbackParams): string {
  return [
    "## Feature Request",
    "",
    buildHeader(params),
    "",
    "---",
    "",
    "## Description",
    "",
    params.summary,
    "",
    "## Use Case",
    "",
    "_(Extracted from user conversation)_",
    "",
    "## Proposed Behavior",
    "",
    "_(As described by user)_",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] _(To be defined)_",
    "",
    buildScreenshot(params.screenshotUrl),
    "---",
    "*Submitted via in-app feedback agent*",
  ].join("\n");
}

function buildGeneralBody(params: FormatFeedbackParams): string {
  return [
    "## User Feedback",
    "",
    buildHeader(params),
    "",
    "---",
    "",
    params.summary,
    "",
    buildScreenshot(params.screenshotUrl),
    "---",
    "*Submitted via in-app feedback agent*",
  ].join("\n");
}

const BODY_BUILDER: Record<
  FeedbackClassification,
  (params: FormatFeedbackParams) => string
> = {
  bug: buildBugBody,
  feature: buildFeatureBody,
  general: buildGeneralBody,
};

export function formatFeedbackIssue(params: FormatFeedbackParams): FormattedIssue {
  const prefix = TITLE_PREFIX[params.classification];
  const maxSummaryLen = 80 - prefix.length;
  const truncatedSummary = truncateOnWordBoundary(params.summary, maxSummaryLen);

  return {
    title: prefix + truncatedSummary,
    body: BODY_BUILDER[params.classification](params),
    labels: LABELS[params.classification],
  };
}
