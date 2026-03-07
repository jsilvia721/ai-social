import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// In Lambda, credentials come from the IAM role linked by SST.
// Locally, credentials come from ~/.aws/credentials or env vars.
const s3 = new S3Client({ region: "us-east-1" });

const BUCKET = process.env.AWS_S3_BUCKET!;
const PUBLIC_URL = process.env.AWS_S3_PUBLIC_URL!.replace(/\/$/, "");

export async function uploadFile(
  file: File,
  key: string,
  mimeType: string
): Promise<string> {
  const bytes = await file.arrayBuffer();
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: Buffer.from(bytes),
      ContentType: mimeType,
    })
  );
  return `${PUBLIC_URL}/${key}`;
}

export function getPublicUrl(key: string): string {
  return `${PUBLIC_URL}/${key}`;
}

export async function getPresignedUploadUrl(
  key: string,
  mimeType: string,
  contentLength?: number,
  expiresInSeconds = 3600
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: mimeType,
    ...(contentLength !== undefined && { ContentLength: contentLength }),
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}
