import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import simpleGit from "simple-git";
import { createReleaseBranchAndCommitChangelog } from "@/lib/git/release";

const tempDirs: string[] = [];

async function createTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arij-release-"));
  tempDirs.push(dir);

  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.name", "Arij Test");
  await git.addConfig("user.email", "arij@example.com");

  fs.writeFileSync(path.join(dir, "README.md"), "# Test\n", "utf-8");
  await git.add(["README.md"]);
  await git.commit("chore: initial");
  await git.branch(["-M", "main"]);

  return { dir, git };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("createReleaseBranchAndCommitChangelog", () => {
  it("creates release branch and commits CHANGELOG.md", async () => {
    const { dir, git } = await createTempRepo();

    const result = await createReleaseBranchAndCommitChangelog(
      dir,
      "1.2.3",
      "# 1.2.3\n\n## Features\n- Added release helper\n\n## Bugfixes\n- None\n\n## Breaking Changes\n- None"
    );

    expect(result.releaseBranch).toBe("release/v1.2.3");
    expect(result.changelogCommitted).toBe(true);
    expect(result.commitHash).toBeTruthy();

    await git.checkout("release/v1.2.3");
    const changelog = fs.readFileSync(path.join(dir, "CHANGELOG.md"), "utf-8");
    expect(changelog).toContain("## Features");
    expect(changelog).toContain("## Bugfixes");
    expect(changelog).toContain("## Breaking Changes");
  });
});
