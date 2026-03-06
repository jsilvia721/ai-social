import { test as setup, expect } from "@playwright/test";
import path from "path";

export const authFile = path.join(__dirname, "../.auth/user.json");

setup("authenticate as test user", async ({ page }) => {
  // Visit the test-only session endpoint with the real browser.
  // The server sets next-auth.session-token as a Set-Cookie response header;
  // the browser stores it in its context automatically — no manual cookie handling needed.
  await page.goto("/api/test/session?email=test@example.com");
  await expect(page.locator("body")).toContainText("ok");

  // Save the browser context state (cookies + localStorage) to disk.
  // All test specs in the chromium project reuse this file via storageState.
  await page.context().storageState({ path: authFile });
});
