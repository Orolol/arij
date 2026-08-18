import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end pass over the GitHub import.
 *
 * Every network call the page makes is stubbed with `page.route()`: the suite
 * verifies the *wiring* — source switch, inline validation, the two progress
 * steps, and the failure path back to `select` — without cloning anything.
 * It therefore runs headless in CI with no network and no GitHub token.
 */

const CLONE_RESPONSE = {
  data: {
    path: "/tmp/arij-e2e/projects/octocat-hello-world",
    ownerRepo: "octocat/hello-world",
    remoteUrl: "https://github.com/octocat/hello-world.git",
    defaultBranch: "main",
    reused: false,
  },
};

const IMPORT_RESPONSE = {
  data: {
    path: "/tmp/arij-e2e/projects/octocat-hello-world",
    fromExistingFile: false,
    preview: {
      project: {
        name: "hello-world",
        description: "A cloned sample project",
        stack: "TypeScript",
      },
      epics: [
        {
          title: "Set up the toolchain",
          description: "Bootstrap linting and tests",
          status: "backlog",
          user_stories: [
            {
              title: "As a dev, I want CI to run the tests",
              description: "",
              acceptance_criteria: "- [ ] CI is green",
              status: "todo",
            },
          ],
        },
      ],
    },
  },
};

/** Keeps the settings hint from depending on the developer's database. */
async function stubSettings(page: Page) {
  await page.route("**/api/settings", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {},
        defaults: { projects_root: "/tmp/arij-e2e/projects" },
      }),
    })
  );
}

/**
 * Stubs an endpoint but holds the response until the test releases it, so
 * each progress step can be observed without racing a sleep. Returns the
 * release function.
 */
async function stubGated(
  page: Page,
  url: string,
  response: { status: number; body: unknown }
): Promise<() => void> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(url, async (route) => {
    await gate;
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    });
  });

  return release;
}

const githubOption = (page: Page) =>
  page.getByRole("radio", { name: "GitHub URL" });
const localOption = (page: Page) =>
  page.getByRole("radio", { name: "Local folder" });
const urlField = (page: Page) =>
  page.getByRole("textbox", { name: "GitHub repository URL" });
const cloneButton = (page: Page) =>
  page.getByRole("button", { name: "Clone & Analyze" });

test.beforeEach(async ({ page }) => {
  await stubSettings(page);
});

test.describe("Import source switch", () => {
  test("offers both import sources", async ({ page }) => {
    await page.goto("/projects/import");

    await expect(page.getByRole("radiogroup", { name: "Import source" })).toBeVisible();
    await expect(localOption(page)).toBeVisible();
    await expect(githubOption(page)).toBeVisible();

    // Local is the default: the pre-existing flow is unchanged.
    await expect(localOption(page)).toHaveAttribute("aria-checked", "true");
    await expect(githubOption(page)).toHaveAttribute("aria-checked", "false");
  });

  test("switches between the folder field and the URL field", async ({ page }) => {
    await page.goto("/projects/import");

    await expect(page.getByPlaceholder("/path/to/your/project")).toBeVisible();
    await expect(urlField(page)).toBeHidden();

    await githubOption(page).click();
    await expect(githubOption(page)).toHaveAttribute("aria-checked", "true");
    await expect(urlField(page)).toBeVisible();
    await expect(page.getByPlaceholder("/path/to/your/project")).toBeHidden();

    // And back — switching is not one-way.
    await localOption(page).click();
    await expect(page.getByPlaceholder("/path/to/your/project")).toBeVisible();
    await expect(urlField(page)).toBeHidden();
  });
});

test.describe("GitHub URL validation", () => {
  test("keeps the submit button disabled until a repository is recognised", async ({
    page,
  }) => {
    await page.goto("/projects/import");
    await githubOption(page).click();

    // Nothing typed: disabled, but no scolding.
    await expect(cloneButton(page)).toBeDisabled();
    await expect(page.locator("#github-url-error")).toHaveCount(0);

    await urlField(page).fill("https://gitlab.com/octocat/hello-world");
    await expect(page.locator("#github-url-error")).toContainText(
      "Not a GitHub repository"
    );
    await expect(cloneButton(page)).toBeDisabled();

    await urlField(page).fill("https://github.com/octocat/hello-world");
    await expect(page.locator("#github-url-error")).toHaveCount(0);
    await expect(cloneButton(page)).toBeEnabled();
  });

  test("rejects a traversal payload inline, without calling the server", async ({
    page,
  }) => {
    let cloneCalls = 0;
    await page.route("**/api/projects/clone", async (route) => {
      cloneCalls += 1;
      await route.fulfill({ status: 201, body: JSON.stringify(CLONE_RESPONSE) });
    });

    await page.goto("/projects/import");
    await githubOption(page).click();
    await urlField(page).fill("octocat/..");

    await expect(page.locator("#github-url-error")).toBeVisible();
    await expect(cloneButton(page)).toBeDisabled();

    await urlField(page).press("Enter");
    expect(cloneCalls).toBe(0);
  });

  test("accepts the shorthand and shows where the clone will land", async ({
    page,
  }) => {
    await page.goto("/projects/import");
    await githubOption(page).click();
    await urlField(page).fill("octocat/hello-world");

    await expect(cloneButton(page)).toBeEnabled();
    await expect(
      page.getByText("/tmp/arij-e2e/projects/octocat-hello-world")
    ).toBeVisible();
  });
});

test.describe("GitHub import flow", () => {
  test("advances through cloning and analyzing to the preview", async ({
    page,
  }) => {
    // Each endpoint is held open until this test lets it answer, so both
    // progress steps are observed rather than raced against a sleep.
    const releaseClone = await stubGated(page, "**/api/projects/clone", {
      status: 201,
      body: CLONE_RESPONSE,
    });
    const releaseImport = await stubGated(page, "**/api/projects/import", {
      status: 200,
      body: IMPORT_RESPONSE,
    });

    await page.goto("/projects/import");
    await githubOption(page).click();
    await urlField(page).fill("https://github.com/octocat/hello-world");
    await cloneButton(page).click();

    // Step 1 — the clone, named as such. A multi-minute clone reported as
    // "Analyzing" would read as a hang.
    const progress = page.getByRole("status");
    await expect(progress).toHaveAttribute("data-step", "cloning");
    await expect(progress).toContainText("Cloning repository...");
    await expect(progress).toContainText("octocat/hello-world");

    releaseClone();

    // Step 2 — analysis of the clone, via the untouched import endpoint.
    await expect(progress).toHaveAttribute("data-step", "analyzing");
    await expect(progress).toContainText("Analyzing project...");

    releaseImport();

    // Step 3 — the preview built from the analysis.
    await expect(
      page.getByRole("button", { name: "Validate & Import" })
    ).toBeVisible();
    // The analysis result, not a placeholder: the preview is editable, so the
    // fields carry the values the stubbed import returned.
    await expect(page.locator("input").first()).toHaveValue("hello-world");
    await expect(page.locator("input").nth(1)).toHaveValue(
      "Set up the toolchain"
    );
    await expect(page.getByText("Epics (1)")).toBeVisible();
    await expect(page.getByText("As a dev, I want CI to run the tests")).toBeVisible();

    // And the spinner is gone — no progress step left running behind it.
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("sends the pasted URL to the clone endpoint and analyzes the returned path", async ({
    page,
  }) => {
    const cloneBodies: unknown[] = [];
    const importBodies: unknown[] = [];

    await page.route("**/api/projects/clone", async (route) => {
      cloneBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(CLONE_RESPONSE),
      });
    });
    await page.route("**/api/projects/import", async (route) => {
      importBodies.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(IMPORT_RESPONSE),
      });
    });

    await page.goto("/projects/import");
    await githubOption(page).click();
    await urlField(page).fill("https://github.com/octocat/hello-world/tree/main");
    await cloneButton(page).click();

    await expect(
      page.getByRole("button", { name: "Validate & Import" })
    ).toBeVisible();

    expect(cloneBodies).toEqual([
      { url: "https://github.com/octocat/hello-world/tree/main" },
    ]);
    // Analysis runs against the clone the server reported, never the URL.
    expect(importBodies).toEqual([
      { path: "/tmp/arij-e2e/projects/octocat-hello-world" },
    ]);
  });

  test("returns to the source selection when the clone fails", async ({
    page,
  }) => {
    await page.route("**/api/projects/clone", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "Repository not found: https://github.com/octocat/nope.git. If it is private, add a GitHub PAT in Settings.",
          code: "not_found",
        }),
      })
    );

    await page.goto("/projects/import");
    await githubOption(page).click();
    await urlField(page).fill("octocat/nope");
    await cloneButton(page).click();

    await expect(page.getByText("Repository not found")).toBeVisible();
    await expect(page.getByText("add a GitHub PAT in Settings")).toBeVisible();

    // Back on the form, with the choice preserved, ready for another attempt.
    await expect(page.getByRole("radiogroup", { name: "Import source" })).toBeVisible();
    await expect(githubOption(page)).toHaveAttribute("aria-checked", "true");
    await expect(urlField(page)).toBeVisible();
    await expect(page.getByRole("status")).toHaveCount(0);
  });

  test("surfaces a conflicting destination without losing the entered URL", async ({
    page,
  }) => {
    await page.route("**/api/projects/clone", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "/tmp/arij-e2e/projects/octocat-hello-world already holds a different repository. Move or remove it, then retry.",
          code: "conflict",
        }),
      })
    );

    await page.goto("/projects/import");
    await githubOption(page).click();
    await urlField(page).fill("octocat/hello-world");
    await cloneButton(page).click();

    await expect(page.getByText("already holds a different repository")).toBeVisible();
    await expect(urlField(page)).toHaveValue("octocat/hello-world");
    await expect(cloneButton(page)).toBeEnabled();
  });
});
