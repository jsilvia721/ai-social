import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXTAUTH_SECRET: z.string().min(1),
  NEXTAUTH_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  TWITTER_CLIENT_ID: z.string().min(1),
  TWITTER_CLIENT_SECRET: z.string().min(1),
  META_APP_ID: z.string().min(1),
  META_APP_SECRET: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  TIKTOK_CLIENT_ID: z.string().min(1),
  TIKTOK_CLIENT_SECRET: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().length(64), // 32-byte AES-256 key as 64 hex chars
  ALLOWED_EMAILS: z.string().min(1),
  BLOTATO_API_KEY: z.string().min(1),
  SES_FROM_EMAIL: z.string().email(),
  // S3: optional in schema, injected by SST in deployed environments
  AWS_S3_BUCKET: z.string().optional(),
  AWS_S3_PUBLIC_URL: z.string().url().optional(),
  MINIO_PUBLIC_URL: z.string().url().optional(), // kept until Phase 3 removes platform code
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

// Validates all required env vars at startup.
// If any are missing or empty, the server will crash with a clear error message.
export const env = serverSchema.parse(process.env);
