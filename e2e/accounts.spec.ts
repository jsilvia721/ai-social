import { test, expect } from "@playwright/test";

test.describe("Accounts page (authenticated)", () => {
  test("accounts page loads with the heading", async ({ page }) => {
    await page.goto("/dashboard/accounts");
    await expect(page).not.toHaveURL(/auth\/signin/);
    await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  });

  test("all platform connect buttons are rendered", async ({ page }) => {
    await page.goto("/dashboard/accounts");
    // Each unconnected platform shows a Connect button
    await expect(page.getByRole("button", { name: /connect twitter/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /connect tiktok/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /connect youtube/i })).toBeVisible();
  });

  test("seeded Twitter account shows as connected", async ({ page }) => {
    await page.goto("/dashboard/accounts");
    // The seeded Twitter account (@e2etestuser) should appear connected
    await expect(page.getByText("@e2etestuser")).toBeVisible();
  });

  test("seeded Instagram account shows as connected", async ({ page }) => {
    await page.goto("/dashboard/accounts");
    // The seeded Instagram account (@e2etestuser_ig) should appear connected
    await expect(page.getByText("@e2etestuser_ig")).toBeVisible();
  });
});
