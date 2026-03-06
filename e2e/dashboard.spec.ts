import { test, expect } from "@playwright/test";

test.describe("Dashboard (authenticated)", () => {
  test("dashboard loads and shows the Overview heading", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).not.toHaveURL(/auth\/signin/);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  });

  test("sidebar navigation links are all present", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Posts" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New Post" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Accounts" })).toBeVisible();
  });

  test("stat cards are rendered (Total Posts, Scheduled, Connected Accounts)", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Total Posts")).toBeVisible();
    await expect(page.getByText("Scheduled")).toBeVisible();
    await expect(page.getByText("Connected Accounts")).toBeVisible();
  });

  test("recent posts section is visible", async ({ page }) => {
    await page.goto("/dashboard");
    // Either the seeded posts appear, or the empty-state message shows
    const postsSection = page.getByRole("heading", { name: "Recent Posts" });
    await expect(postsSection).toBeVisible();
  });

  test("sidebar shows the test user email", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("test@example.com")).toBeVisible();
  });
});
