import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createIssue } from "@/lib/github";
import { reportServerError } from "@/lib/server-error-reporter";
import { assertSafeMediaUrl } from "@/lib/blotato/ssrf-guard";
import { formatFeedbackIssue } from "@/lib/feedback-formatter";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

const messageSchema = z.object({
  role: z.string().min(1),
  content: z.string().min(1),
});

const submitSchema = z.object({
  messages: z.array(messageSchema).min(1),
  summary: z.string().min(1).max(5000),
  classification: z.enum(["bug", "feature", "general"]),
  context: z.object({
    pageUrl: z.string().url().optional(),
    screenshotUrl: z.string().url().optional(),
  }),
});

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

  const parsed = submitSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const { messages, summary, classification, context } = parsed.data;
  const { pageUrl, screenshotUrl } = context;

  // SSRF guard: screenshotUrl must be hosted on our storage
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
        message: summary,
        pageUrl,
        screenshotUrl,
        status: "PENDING",
        conversationHistory: messages as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    await reportServerError(
      `Failed to create feedback record: ${error instanceof Error ? error.message : String(error)}`,
      { url: "/api/feedback/submit" }
    );
    return NextResponse.json(
      { error: "Failed to save feedback" },
      { status: 500 }
    );
  }

  // 2. Format and create GitHub issue
  let githubIssueNumber: number | undefined;
  let githubIssueUrl: string | undefined;

  try {
    const userName =
      session.user.name || session.user.email || "Unknown user";
    const formatted = formatFeedbackIssue({
      classification,
      summary,
      userName,
      pageUrl,
      screenshotUrl,
    });

    const issue = await createIssue(formatted.title, formatted.body, formatted.labels);
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
    const errMsg = error instanceof Error ? error.message : String(error);

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
        { url: "/api/feedback/submit" }
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
