import { test as base, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A throwaway Arij project, board URL included.
 *
 * The board is only reachable for a project row that already exists, and every
 * spec here creates tickets on it — so each test gets its own project pointing
 * at its own scratch git repo under the OS temp directory. Nothing a test
 * creates can then reach another test's board, and the `arji.json` the sync
 * export writes lands in the scratch repo rather than in this one.
 */
export interface ArijProject {
  id: string;
  name: string;
  /** Absolute path of the scratch repo the project is attached to. */
  repoPath: string;
  /** Path to navigate to for the kanban board. */
  boardUrl: string;
}

/**
 * `validatePath` (which `POST /api/projects` runs on `gitRepoPath`) requires an
 * existing directory, and the board's git surfaces expect a real repository
 * with a branch — hence the empty initial commit rather than a bare `mkdir`.
 */
function createScratchRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "arij-e2e-"));

  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        dir,
        "-c",
        "user.email=e2e@arij.local",
        "-c",
        "user.name=Arij E2E",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { stdio: "ignore" }
    );

  git("init", "-b", "main");
  git("commit", "--allow-empty", "-m", "initial");

  return dir;
}

export const test = base.extend<{ project: ArijProject }>({
  project: async ({ request }, use, testInfo) => {
    const repoPath = createScratchRepo();
    // `createProjectSchema` caps the name at 200 chars, and the worker index
    // keeps two parallel tests of the same title apart.
    const name = `E2E ${testInfo.title}`.slice(0, 180) + ` #${testInfo.workerIndex}`;

    const created = await request.post("/api/projects", {
      data: { name, gitRepoPath: repoPath },
    });
    expect(
      created.ok(),
      `project creation failed: ${created.status()} ${await created.text()}`
    ).toBeTruthy();

    const { data } = (await created.json()) as { data: { id: string } };
    const project: ArijProject = {
      id: data.id,
      name,
      repoPath,
      boardUrl: `/projects/${data.id}`,
    };

    await use(project);

    // No `removeDirectory=true`: this project was never cloned by Arij, so the
    // route would decline anyway — the scratch repo is ours to remove.
    await request.delete(`/api/projects/${project.id}`);
    rmSync(repoPath, { recursive: true, force: true });
  },
});

export { expect };
