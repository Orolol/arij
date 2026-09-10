import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { shortProjectName } from "../lib/control-desk/aggregate";
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
  let projectId: string | null = null;
  try {
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
    if (created.ok()) {
      const body = (await created.json()) as { data: { id: string } };
      projectId = body.data.id;
    }
    expect(
      created.ok(),
      `scratch project creation failed: ${created.status()} ${await created.text()}`,
    ).toBeTruthy();

    return { id: projectId!, name, rootPath };
  } catch (error) {
    if (projectId) {
      await request.delete(`/api/projects/${projectId}`).catch(() => undefined);
    }
    rmSync(rootPath, { recursive: true, force: true });
    throw error;
  }
}

async function removeScratchProject(request: APIRequestContext, project: ScratchProject) {
  let deleteError: unknown = null;
  try {
    const deleted = await request.delete(`/api/projects/${project.id}`);
    expect(deleted.ok(), `DELETE /api/projects/${project.id} failed`).toBeTruthy();
  } catch (error) {
    deleteError = error;
  } finally {
    rmSync(project.rootPath, { recursive: true, force: true });
  }
  if (deleteError) throw deleteError;
}

for (const scope of ["global", "project"] as const) {
  test(`${scope} composer confirms a real creation and opens its ticket`, async ({ page, project, request }, testInfo) => {
    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));

    let unrelated: ScratchProject | null = null;
    try {
      if (scope === "global") {
        // Seed an unrelated earlier project. `deriveProjects` orders by `created_at`,
        // so backdating ensures it sits at `projects[0]` — the exact trap under fullyParallel
        // where an untargeted cross-project composer would write into a neighbour's project.
        unrelated = await createScratchProject(
          request,
          `Unrelated Earlier Project #${testInfo.workerIndex}`,
        );
        withDatabase((db) => {
          db.prepare("UPDATE projects SET created_at = '2000-01-01 00:00:00' WHERE id = ?").run(
            unrelated!.id,
          );
        });
      }

      await page.goto(scope === "global" ? "/" : project.boardUrl);
      const input = page.getByRole("textbox", { name: "Describe a feature" });
      await expect(input).toBeEnabled();

      if (scope === "global") {
        expect(unrelated).not.toBeNull();
        const selectPill = page.getByTestId("desk-project-select");
        const unrelatedShortName = shortProjectName(unrelated!.name);
        const fixtureShortName = shortProjectName(project.name);

        // Before explicit selection, verify that the composer defaulted to the earlier
        // unrelated project (projects[0]), establishing the adversarial precondition.
        await expect(selectPill).toHaveText(unrelatedShortName);
        await expect(selectPill).not.toHaveText(fixtureShortName);

        // Explicitly retarget the composer to this test fixture's project.
        await selectPill.click();
        await page.getByRole("menuitem", { name: project.name, exact: true }).click();
        await expect(selectPill).toHaveText(fixtureShortName);

        // Concurrently tear down the earlier project while the composer is active,
        // proving that having targeted our own project insulates us from other workers'
        // teardown mid-flight (the exact cause of B-arij-256).
        const toDelete = unrelated!;
        unrelated = null;
        await removeScratchProject(request, toDelete);
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
