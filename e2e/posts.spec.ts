import { test, expect } from "@playwright/test";

test.describe("Posts list (authenticated)", () => {
  test("posts page loads and shows the list view by default", async ({ page }) => {
    await page.goto("/dashboard/posts");
    await expect(page).not.toHaveURL(/auth\/signin/);
    // List/Calendar toggle buttons
    await expect(page.getByRole("button", { name: /list/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /calendar/i })).toBeVisible();
  });

  test("tab navigation renders all tab labels", async ({ page }) => {
    await page.goto("/dashboard/posts");
    await expect(page.getByRole("button", { name: "All" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Scheduled" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Published" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Failed" })).toBeVisible();
  });

  test("seeded posts are displayed in the All tab", async ({ page }) => {
    await page.goto("/dashboard/posts");
    // Seeded content from prisma/seed.ts
    await expect(page.getByText("This is a draft post for E2E testing")).toBeVisible();
    await expect(page.getByText("This is a scheduled post for E2E testing")).toBeVisible();
    await expect(page.getByText("This is a published post for E2E testing")).toBeVisible();
  });

  test("Scheduled tab filters to show only scheduled posts", async ({ page }) => {
    await page.goto("/dashboard/posts");
    await page.getByRole("button", { name: "Scheduled" }).click();
    await expect(page.getByText("This is a scheduled post for E2E testing")).toBeVisible();
    await expect(page.getByText("This is a draft post for E2E testing")).not.toBeVisible();
  });

  test("Published tab filters to show only published posts", async ({ page }) => {
    await page.goto("/dashboard/posts");
    await page.getByRole("button", { name: "Published" }).click();
    await expect(page.getByText("This is a published post for E2E testing")).toBeVisible();
    await expect(page.getByText("This is a draft post for E2E testing")).not.toBeVisible();
  });

  test("New Post button navigates to the composer", async ({ page }) => {
    await page.goto("/dashboard/posts");
    await page.getByRole("link", { name: /new post/i }).first().click();
    await expect(page).toHaveURL(/posts\/new/);
  });
});
