import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    // Runs once before all tests: hits /api/test/session and saves cookies to disk.
    {
      name: "setup",
      testMatch: /fixtures\/auth\.setup\.ts/,
    },
    // Main test project — reuses the authenticated session saved by setup.
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: process.env.CI ? "npm start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    env: {
      PLAYWRIGHT_E2E: "true",
      // Allow the E2E test user regardless of what .env.local has for ALLOWED_EMAILS.
      // process.env vars take precedence over Next.js .env files.
      ALLOWED_EMAILS: "test@example.com",
    },
  },
});
