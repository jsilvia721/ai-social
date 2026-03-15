import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createIssue } from "@/lib/github";
import { reportServerError } from "@/lib/server-error-reporter";
import { assertSafeMediaUrl } from "@/lib/blotato/ssrf-guard";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const feedbackSchema = z.object({
  message: z.string().min(1).max(5000),
  pageUrl: z.string().url().optional(),
  screenshotUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Truncate text to maxLen on a word boundary, appending "…" if truncated.
 */
function truncateOnWordBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 0) {
    return truncated.slice(0, lastSpace) + "…";
  }
  return truncated + "…";
}

function buildIssueBody(params: {
  userName: string;
  pageUrl?: string;
  message: string;
  screenshotUrl?: string;
}): string {
  const lines = [
    "## User Feedback",
    "",
    `**From:** ${params.userName}`,
    `**Page:** ${params.pageUrl || "Not captured"}`,
    `**Date:** ${new Date().toISOString()}`,
    "",
    "---",
    "",
    params.message,
    "",
  ];

  if (params.screenshotUrl) {
    lines.push(`![Screenshot](${params.screenshotUrl})`, "");
  }

  lines.push("---", "*Submitted via in-app feedback*");

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = feedbackSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { message, pageUrl, screenshotUrl, metadata } = parsed.data;

  // SSRF guard: screenshotUrl must start with our S3 public URL
  if (screenshotUrl) {
    try {
      assertSafeMediaUrl(screenshotUrl);
    } catch {
      return NextResponse.json(
        { error: "Screenshot URL must be hosted on our storage" },
        { status: 400 }
      );
    }
  }

  // 1. Create DB record with PENDING status
  let feedback;
  try {
    feedback = await prisma.feedback.create({
      data: {
        userId: session.user.id,
        message,
        pageUrl,
        screenshotUrl,
        status: "PENDING",
        metadata: metadata as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    await reportServerError(
      `Failed to create feedback record: ${error instanceof Error ? error.message : String(error)}`,
      { url: "/api/feedback" }
    );
    return NextResponse.json(
      { error: "Failed to save feedback" },
      { status: 500 }
    );
  }

  // 2. Attempt GitHub issue creation (non-blocking)
  let githubIssueNumber: number | undefined;
  let githubIssueUrl: string | undefined;

  try {
    const title = "[Feedback] " + truncateOnWordBoundary(message, 69);
    const userName =
      session.user.name || session.user.email || "Unknown user";
    const body = buildIssueBody({
      userName,
      pageUrl,
      message,
      screenshotUrl,
    });

    const issue = await createIssue(title, body, ["needs-triage"]);
    githubIssueNumber = issue.number;
    githubIssueUrl = issue.html_url;

    // 3. Update to ISSUE_CREATED
    await prisma.feedback.update({
      where: { id: feedback.id },
      data: {
        status: "ISSUE_CREATED",
        githubIssueNumber,
        githubIssueUrl,
      },
    });
  } catch (error) {
    const errMsg =
      error instanceof Error ? error.message : String(error);

    // If GitHub token not configured, leave as PENDING
    if (errMsg.includes("not configured")) {
      // Leave as PENDING — no update needed
    } else {
      // 4. GitHub failure: update to FAILED
      try {
        await prisma.feedback.update({
          where: { id: feedback.id },
          data: { status: "FAILED" },
        });
      } catch {
        // Best-effort update
      }
      await reportServerError(
        `Failed to create GitHub issue for feedback: ${errMsg}`,
        { url: "/api/feedback" }
      );
    }
  }

  return NextResponse.json(
    {
      id: feedback.id,
      ...(githubIssueNumber !== undefined && { githubIssueNumber }),
      ...(githubIssueUrl !== undefined && { githubIssueUrl }),
    },
    { status: 201 }
  );
}
