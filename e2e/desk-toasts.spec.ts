import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures/arij-project";
import { withDatabase } from "./fixtures/data-root";

interface ScratchProject {
  id: string;
  name: string;
  rootPath: string;
}

/**
 * A second, unrelated project used to prove that the global composer's
 * explicit selection targets its own fixture rather than falling back to
 * `projects[0]` in a multi-project workspace.
 */
async function createScratchProject(
  request: APIRequestContext,
  name: string,
): Promise<ScratchProject> {
  const rootPath = mkdtempSync(path.join(tmpdir(), "arij-e2e-toast-"));
  const repoPath = path.join(rootPath, "repo");
  mkdirSync(repoPath);

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repoPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-b", "main");
  git("config", "user.email", "e2e@arij.local");
  git("config", "user.name", "Arij E2E");
  git("config", "commit.gpgsign", "false");
  git("commit", "--allow-empty", "-m", "initial");

  const created = await request.post("/api/projects", {
    data: { name, gitRepoPath: repoPath },
  });
  expect(
    created.ok(),
    `scratch project creation failed: ${created.status()} ${await created.text()}`,
  ).toBeTruthy();

  const { data } = (await created.json()) as { data: { id: string } };
  return { id: data.id, name, rootPath };
}

async function removeScratchProject(request: APIRequestContext, project: ScratchProject) {
  const deleted = await request.delete(`/api/projects/${project.id}`);
  rmSync(project.rootPath, { recursive: true, force: true });
  expect(deleted.ok(), `DELETE /api/projects/${project.id} failed`).toBeTruthy();
}

for (const scope of ["global", "project"] as const) {
  test(`${scope} composer confirms a real creation and opens its ticket`, async ({ page, project, request }, testInfo) => {
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    let unrelated: ScratchProject | null = null;
    if (scope === "global") {
      // Seed an unrelated earlier project. `GET /api/projects` orders by `updated_at`,
      // so backdating ensures it sits at `projects[0]` — the exact trap under fullyParallel
      // where an untargeted cross-project composer would write into a neighbour's project.
      unrelated = await createScratchProject(
        request,
        `Unrelated Earlier Project #${testInfo.workerIndex}`,
      );
      withDatabase((db) => {
        db.prepare("UPDATE projects SET updated_at = '2000-01-01 00:00:00' WHERE id = ?").run(
          unrelated!.id,
        );
      });
    }

    try {
      await page.goto(scope === "global" ? "/" : project.boardUrl);
      const input = page.getByRole("textbox", { name: "Describe a feature" });
      await expect(input).toBeEnabled();
      // The cross-project desk has no project of its own, so the composer falls
      // back to `projects[0]` (DeskComposer.tsx) — under `fullyParallel` that is
      // whichever project another worker happened to seed first, and the ticket
      // would be written there while the toast still appeared here. Target this
      // fixture's project by name, which the worker index keeps unique.
      // NOT done for the `project` scope: that run's subject IS the route's own
      // project being the default.
      if (scope === "global") {
        await page.getByTestId("desk-project-select").click();
        await page.getByRole("menuitem", { name: project.name, exact: true }).click();

        // Concurrently tear down the earlier project while the composer is active,
        // proving that having targeted our own project insulates us from other workers'
        // teardown mid-flight (the exact cause of B-arij-256).
        if (unrelated) {
          await removeScratchProject(request, unrelated);
          unrelated = null;
        }
      }
      const title = `Notification ${scope} ${project.id}`;
      await input.fill(title);
      await input.press("Enter");
      const toast = page.getByRole("status").filter({ hasText: title });
      await expect(toast).toBeVisible();
      const ticket = withDatabase((db) => db.prepare("SELECT id FROM epics WHERE project_id = ? AND title = ?").get(project.id, title)) as { id: string };
      expect(ticket).toBeTruthy();
      const link = toast.getByRole("link", { name: "View the ticket" });
      await expect(link).toHaveAttribute("href", `/projects/${project.id}?ticket=${ticket.id}`);
      await expect(input).toHaveValue("");
      await toast.hover();
      await page.screenshot({ path: `data/toast-${scope}.png` });
      await link.click();
      await expect(page.getByTestId("ticket-overlay")).toBeVisible();
      await expect(page.getByTestId("ticket-overlay")).toContainText(title);
      expect(browserErrors).toEqual([]);
    } finally {
      if (unrelated) {
        await removeScratchProject(request, unrelated);
      }
    }
  });
}

test("creation errors stay visible and preserve the draft on a narrow screen", async ({ page, project }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(`**/api/projects/${project.id}/epics`, async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 400, json: { error: "Création refusée pour ce test" } });
    } else await route.continue();
  });
  await page.goto(project.boardUrl);
  const input = page.getByRole("textbox", { name: "Describe a feature" });
  await expect(input).toBeEnabled();
  await input.fill("Mon brouillon");
  await input.press("Enter");
  const toast = page.getByRole("alert").filter({ hasText: "Création refusée" });
  await expect(toast).toBeVisible();
  await expect(input).toHaveValue("Mon brouillon");
  const bounds = await toast.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "data/toast-mobile.png" });
  await toast.getByRole("button", { name: "Dismiss notification" }).click();
  await expect(toast).toBeHidden();
});
