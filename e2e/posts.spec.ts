import { test, expect } from "@playwright/test";

// Full post creation E2E tests require a real authenticated session.
// These tests are structured as stubs that can be expanded once
// a test auth bypass (e.g., a /api/test/auth route gated by NODE_ENV=test)
// is implemented.

test.describe("Posts (authenticated)", () => {
  test.skip("requires auth bypass — see e2e/README for setup instructions", () => {
    // Example of what a full E2E test would look like:
    // 1. Visit sign-in page
    // 2. Authenticate via test bypass
    // 3. Navigate to /dashboard
    // 4. Click "New Post"
    // 5. Fill in content + select account + set schedule
    // 6. Submit and verify post appears in the scheduled list
  });
});
