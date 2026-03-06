import { test, expect } from "@playwright/test";

// Unauthenticated tests — override the global storageState with an empty context.
test.describe("Authentication (unauthenticated)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated user visiting / is redirected to sign-in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/auth\/signin/);
  });

  test("unauthenticated user visiting /dashboard is redirected to sign-in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/auth\/signin/);
  });

  test("sign-in page renders the Google sign-in button", async ({ page }) => {
    await page.goto("/auth/signin");
    await expect(page).not.toHaveTitle(/error/i);
    await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
  });
});
