import { test, expect } from "@playwright/test";

test.describe("Home page", () => {
  test("loads and displays the heading", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "To get started, edit the page.tsx file."
    );
  });

  test("displays the Next.js logo", async ({ page }) => {
    await page.goto("/");

    const logo = page.getByAltText("Next.js logo");
    await expect(logo).toBeVisible();
  });

  test("has a Deploy Now link that opens in a new tab", async ({ page }) => {
    await page.goto("/");

    const deployLink = page.getByRole("link", { name: "Deploy Now" });
    await expect(deployLink).toBeVisible();
    await expect(deployLink).toHaveAttribute("target", "_blank");
  });

  test("has a Documentation link that opens in a new tab", async ({ page }) => {
    await page.goto("/");

    const docsLink = page.getByRole("link", { name: "Documentation" });
    await expect(docsLink).toBeVisible();
    await expect(docsLink).toHaveAttribute("target", "_blank");
  });

  test("page has correct title", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Create Next App");
  });
});
