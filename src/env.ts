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
  REPLICATE_API_TOKEN: z.string().optional(),
  REPLICATE_WEBHOOK_SECRET: z.string().optional(),
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
  // GitHub integration: optional — brainstorm agent uses these to manage issues
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_REPO_OWNER: z.string().optional(),
  GITHUB_REPO_NAME: z.string().optional(),
  GITHUB_BOT_USERNAME: z.string().optional(),
  BRAINSTORM_FREQUENCY_DAYS: z.coerce.number().optional(),
  // EventBridge rule names: injected by SST from cron construct properties
  PUBLISH_RULE_NAME: z.string().optional(),
  METRICS_RULE_NAME: z.string().optional(),
  RESEARCH_RULE_NAME: z.string().optional(),
  BRIEFS_RULE_NAME: z.string().optional(),
  FULFILL_RULE_NAME: z.string().optional(),
  OPTIMIZE_RULE_NAME: z.string().optional(),
  BRAINSTORM_RULE_NAME: z.string().optional(),
  MOCK_EXTERNAL_APIS: z.enum(["true", "false"]).optional(),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
});

// Validates all required env vars at startup.
// If any are missing or empty, the server will crash with a clear error message.
export const env = serverSchema.parse(process.env);
