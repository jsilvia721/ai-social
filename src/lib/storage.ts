import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/env";

// In Lambda, credentials come from the IAM execution role — no static keys needed.
// Locally, set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION in .env.local.
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });

const bucket = env.AWS_S3_BUCKET ?? "ai-social-dev";
const publicBase = env.AWS_S3_PUBLIC_URL ?? "http://localhost:9000/ai-social-dev";

export async function uploadFile(
  file: File,
  key: string,
  mimeType: string
): Promise<string> {
  const bytes = await file.arrayBuffer();
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(bytes),
      ContentType: mimeType,
    })
  );
  return getPublicUrl(key);
}

export function getPublicUrl(key: string): string {
  const base = publicBase.endsWith("/") ? publicBase.slice(0, -1) : publicBase;
  return `${base}/${key}`;
}

export async function getPresignedUploadUrl(
  key: string,
  mimeType: string,
  contentLength?: number,
  expiresInSeconds = 3600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: mimeType,
    ...(contentLength !== undefined && { ContentLength: contentLength }),
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}
