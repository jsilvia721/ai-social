import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

const bucket = process.env.MINIO_BUCKET ?? "ai-social";

const s3 = new S3Client({
  endpoint: process.env.MINIO_ENDPOINT ?? "http://minio:9000",
  region: "us-east-1",
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.MINIO_ACCESS_KEY ?? "",
    secretAccessKey: process.env.MINIO_SECRET_KEY ?? "",
  },
});

export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    await s3.send(
      new PutBucketPolicyCommand({
        Bucket: bucket,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: "*",
              Action: "s3:GetObject",
              Resource: `arn:aws:s3:::${bucket}/*`,
            },
          ],
        }),
      })
    );
  }
}

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
  const publicUrl = process.env.MINIO_PUBLIC_URL ?? "http://localhost:9000";
  return `${publicUrl}/${bucket}/${key}`;
}
