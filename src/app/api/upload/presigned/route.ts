import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPresignedUploadUrl, getPublicUrl } from "@/lib/storage";

const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
]);

const EXT_MAP: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-msvideo": "avi",
};

const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500 MB

// Returns a presigned S3 PUT URL so the browser can upload video directly,
// bypassing the Next.js server and avoiding Railway request timeout/size limits.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mimeType = searchParams.get("mimeType");
  const fileSize = searchParams.get("fileSize");

  if (!mimeType || !ALLOWED_VIDEO_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "Unsupported video type" }, { status: 400 });
  }

  if (fileSize && parseInt(fileSize, 10) > MAX_VIDEO_SIZE) {
    return NextResponse.json({ error: "File too large (max 500 MB)" }, { status: 400 });
  }

  const ext = EXT_MAP[mimeType];
  const key = `uploads/${session.user.id}/${crypto.randomUUID()}.${ext}`;

  const uploadUrl = await getPresignedUploadUrl(key, mimeType);
  const publicUrl = getPublicUrl(key);

  return NextResponse.json({ uploadUrl, publicUrl });
}
