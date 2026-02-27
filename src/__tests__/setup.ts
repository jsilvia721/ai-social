// This file runs via setupFiles BEFORE any module is imported.
// It populates process.env with fake test values so that src/env.ts
// can complete its synchronous Zod parse without throwing.

process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/ai_social_test";
process.env.NEXTAUTH_SECRET = "test-secret-that-is-long-enough-for-testing-purposes!";
process.env.NEXTAUTH_URL = "http://localhost:3000";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.TWITTER_CLIENT_ID = "test-twitter-client-id";
process.env.TWITTER_CLIENT_SECRET = "test-twitter-client-secret";
process.env.META_APP_ID = "test-meta-app-id";
process.env.META_APP_SECRET = "test-meta-app-secret";
process.env.ANTHROPIC_API_KEY = "test-anthropic-api-key";
process.env.NODE_ENV = "test";
