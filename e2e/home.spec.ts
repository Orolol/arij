import { test, expect } from "@playwright/test";

test.describe("Dashboard smoke", () => {
  test("home page loads with the Arij title", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Arij");
  });

  test("renders the projects dashboard heading", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { level: 1, name: "Projects" })
    ).toBeVisible();
  });

  test("shows the New Project entry point", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator('a[href="/projects/new"]').first()).toBeVisible();
  });
});
