import { test, expect } from "@playwright/test";

test.describe("Accounts page (authenticated)", () => {
  test("accounts page loads with the heading", async ({ page }) => {
    await page.goto("/dashboard/accounts");
    await expect(page).not.toHaveURL(/auth\/signin/);
    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
  });

  test("imported accounts section is rendered", async ({ page }) => {
    await page.goto("/dashboard/accounts");
    // The redesigned page always shows an "Imported Accounts" heading
    await expect(page.getByRole("heading", { name: /imported accounts/i })).toBeVisible();
  });

  test("seeded Twitter account shows as connected", async ({ page }) => {
    await page.goto("/dashboard/accounts");
    // Use exact:true — "@e2etestuser" is a substring of "@e2etestuser_ig" (Instagram).
    await expect(page.getByText("@e2etestuser", { exact: true })).toBeVisible();
  });

  test("seeded Instagram account shows as connected", async ({ page }) => {
    await page.goto("/dashboard/accounts");
    // The seeded Instagram account (@e2etestuser_ig) should appear connected
    await expect(page.getByText("@e2etestuser_ig")).toBeVisible();
  });
});
