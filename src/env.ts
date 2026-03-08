import { z } from "zod";

const isMocked = process.env.MOCK_EXTERNAL_APIS === "true" ||
  (process.env.MOCK_EXTERNAL_APIS !== "false" && process.env.NODE_ENV !== "production");

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXTAUTH_SECRET: z.string().min(1),
  NEXTAUTH_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  // External API keys: required in production, optional when mocked
  ANTHROPIC_API_KEY: isMocked ? z.string().default("mock-key") : z.string().min(1),
  BLOTATO_API_KEY: isMocked ? z.string().default("mock-key") : z.string().min(1),
  SES_FROM_EMAIL: z.string().email().optional(),
  ALLOWED_EMAILS: z.string().min(1),
  ADMIN_EMAILS: z.string().optional(), // comma-separated list of admin emails
  // S3: optional in schema, injected by SST in deployed environments
  AWS_S3_BUCKET: z.string().optional(),
  AWS_S3_PUBLIC_URL: z.string().url().optional(),
  // M2 Content Intelligence: optional research sources
  SERPAPI_KEY: z.string().optional(),
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  MOCK_EXTERNAL_APIS: z.enum(["true", "false"]).optional(),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

// Validates all required env vars at startup.
// If any are missing or empty, the server will crash with a clear error message.
export const env = serverSchema.parse(process.env);
