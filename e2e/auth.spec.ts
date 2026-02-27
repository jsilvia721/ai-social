import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("unauthenticated user visiting / is redirected to sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/auth\/signin/);
  });

  test("sign-in page renders without errors", async ({ page }) => {
    await page.goto("/auth/signin");
    // Page should load (not 404 or 500)
    await expect(page).not.toHaveTitle(/error/i);
    await expect(page.locator("body")).toBeVisible();
  });
});
