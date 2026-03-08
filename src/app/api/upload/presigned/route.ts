import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { getPresignedUploadUrl, getPublicUrl } from "@/lib/storage";

const ALLOWED_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const EXT_MAP: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

const IMAGE_MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const VIDEO_MAX_SIZE = 500 * 1024 * 1024; // 500 MB

function isVideoType(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

function getMaxSize(mimeType: string): number {
  return isVideoType(mimeType) ? VIDEO_MAX_SIZE : IMAGE_MAX_SIZE;
}

function formatSize(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

// Returns a presigned S3 PUT URL so the browser can upload directly,
// bypassing the Next.js server and avoiding Lambda payload limits.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mimeType = searchParams.get("mimeType");
  const fileSize = searchParams.get("fileSize");

  if (!mimeType || !ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  if (!fileSize) {
    return NextResponse.json({ error: "fileSize is required" }, { status: 400 });
  }
  const fileSizeNum = parseInt(fileSize, 10);
  if (isNaN(fileSizeNum) || fileSizeNum <= 0) {
    return NextResponse.json({ error: "fileSize must be a positive number" }, { status: 400 });
  }

  const maxSize = getMaxSize(mimeType);
  if (fileSizeNum > maxSize) {
    return NextResponse.json(
      { error: `File too large (max ${formatSize(maxSize)})` },
      { status: 400 }
    );
  }

  const ext = EXT_MAP[mimeType];
  const key = `uploads/${session.user.id}/${crypto.randomUUID()}.${ext}`;

  const uploadUrl = await getPresignedUploadUrl(key, mimeType, fileSizeNum);
  const publicUrl = getPublicUrl(key);

  return NextResponse.json({ uploadUrl, publicUrl });
}
