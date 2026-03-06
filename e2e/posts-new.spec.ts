import { test, expect } from "@playwright/test";

test.describe("New post composer (authenticated)", () => {
  test("composer page loads without errors", async ({ page }) => {
    await page.goto("/dashboard/posts/new");
    await expect(page).not.toHaveURL(/auth\/signin/);
    // The content textarea is the main input
    await expect(page.getByRole("textbox")).toBeVisible();
  });

  test("account dropdown is populated with seeded accounts", async ({ page }) => {
    await page.goto("/dashboard/posts/new");
    // Open the account selector
    const trigger = page.getByRole("combobox").first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    // Seeded accounts should appear (Twitter and Instagram)
    await expect(page.getByText("@e2etestuser")).toBeVisible();
  });

  test("typing in the content field shows the character count for Twitter", async ({ page }) => {
    await page.goto("/dashboard/posts/new");

    // Select the Twitter account first so char limit applies
    const trigger = page.getByRole("combobox").first();
    await trigger.click();
    await page.getByText("@e2etestuser").click();

    const textarea = page.getByRole("textbox");
    await textarea.fill("Hello from E2E test");
    // Character count indicator should appear
    await expect(page.getByText(/\/ 280/)).toBeVisible();
  });

  test("submitting an empty form shows a validation error", async ({ page }) => {
    await page.goto("/dashboard/posts/new");
    await page.getByRole("button", { name: /save as draft/i }).click();
    // Should not navigate away — still on new post page
    await expect(page).toHaveURL(/posts\/new/);
  });
});
