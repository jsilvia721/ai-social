// This file runs via setupFiles BEFORE any module is imported.
// It populates process.env with fake test values so that src/env.ts
// can complete its synchronous Zod parse without throwing.

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/ai_social_test";
process.env.NEXTAUTH_SECRET = "test-secret-that-is-long-enough-for-testing-purposes!";
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.ANTHROPIC_API_KEY = "test-anthropic-api-key";
process.env.REPLICATE_API_TOKEN = "test-replicate-api-token";
process.env.BLOTATO_API_KEY = "test-blotato-api-key";
process.env.SES_FROM_EMAIL = "noreply@example.com";
process.env.ALLOWED_EMAILS = "test@example.com";
process.env.AWS_S3_BUCKET = "test-bucket";
process.env.AWS_S3_PUBLIC_URL = "https://storage.example.com";
process.env.PLAYWRIGHT_E2E = "true";
// Disable external API mocking in tests — tests have their own mocks/spies
process.env.MOCK_EXTERNAL_APIS = "false";
(process.env as any).NODE_ENV = "test";
