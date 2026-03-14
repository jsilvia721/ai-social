import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getReviewPosts, serializeReviewPosts } from "@/lib/queries/review-posts";
import { reportServerError } from "@/lib/server-error-reporter";

export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const posts = await getReviewPosts(session);
    if (posts === null) {
      return NextResponse.json({ posts: [] });
    }

    return NextResponse.json({ posts: serializeReviewPosts(posts) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportServerError(message, { metadata: { context: "GET /api/review/posts" } });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
