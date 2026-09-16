import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import simpleGit from "simple-git";
import { captureMergeCheckpoint, mergeWorktree, rollbackMerge } from "@/lib/git/manager";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

async function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arij-merge-integrity-"));
  fixtures.push(root);
  const repo = path.join(root, "repo");
  const worktree = path.join(root, "worktree");
  fs.mkdirSync(repo);
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.name", "Arij Test");
  await git.addConfig("user.email", "arij@example.com");
  await git.addConfig("commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "README.md"), "base\n");
  fs.writeFileSync(path.join(repo, ".gitignore"), "runtime/\n");
  await git.add(["README.md", ".gitignore"]);
  await git.commit("initial");
  await git.branch(["-M", "main"]);
  const mainHead = (await git.revparse(["main"])).trim();
  await git.checkoutLocalBranch("develop");
  fs.writeFileSync(path.join(repo, "develop.txt"), "integration branch\n");
  await git.add(["develop.txt"]);
  await git.commit("develop only");
  const developHead = (await git.revparse(["develop"])).trim();
  await git.raw(["worktree", "add", "-b", "feature/task", worktree, "develop"]);
  const worktreeGit = simpleGit(worktree);
  fs.writeFileSync(path.join(worktree, "feature.txt"), "committed work\n");
  await worktreeGit.add(["feature.txt"]);
  await worktreeGit.commit("feature");
  const featureHead = (await worktreeGit.revparse(["HEAD"])).trim();
  return { repo, worktree, git, worktreeGit, mainHead, developHead, featureHead };
}

describe("merge preserves repository state", () => {
  it("merges and rolls back develop while leaving a distinct main unchanged", async () => {
    const fixture = await createFixture();
    const checkpoint = await captureMergeCheckpoint(fixture.repo, "feature/task", { defaultBranch: "develop" });
    expect(checkpoint).toMatchObject({ mainBranch: "develop", mainHead: fixture.developHead });

    expect(await mergeWorktree(fixture.repo, "feature/task", fixture.worktree, { defaultBranch: "develop" }))
      .toMatchObject({ merged: true });
    expect((await fixture.git.revparse(["develop"])).trim()).not.toBe(fixture.developHead);
    expect((await fixture.git.revparse(["main"])).trim()).toBe(fixture.mainHead);

    expect(await rollbackMerge(fixture.repo, checkpoint!)).toEqual({ restored: true });
    expect((await fixture.git.revparse(["develop"])).trim()).toBe(fixture.developHead);
    expect((await fixture.git.revparse(["main"])).trim()).toBe(fixture.mainHead);
    expect((await fixture.git.revparse(["feature/task"])).trim()).toBe(fixture.featureHead);
  });

  it.each(["modified", "staged", "untracked"] as const)("preserves a worktree with %s changes", async (kind) => {
    const fixture = await createFixture();
    const filename = kind === "untracked" ? "unfinished.txt" : "feature.txt";
    fs.writeFileSync(path.join(fixture.worktree, filename), "unfinished user work\n");
    if (kind === "staged") await fixture.worktreeGit.add([filename]);

    const result = await mergeWorktree(fixture.repo, "feature/task", fixture.worktree, { defaultBranch: "develop" });
    expect(result).toMatchObject({ merged: false, reason: "error" });
    expect(result.error).toContain("uncommitted changes");
    expect(fs.readFileSync(path.join(fixture.worktree, filename), "utf8")).toBe("unfinished user work\n");
    expect((await fixture.git.revparse(["develop"])).trim()).toBe(fixture.developHead);
    expect((await fixture.git.revparse(["feature/task"])).trim()).toBe(fixture.featureHead);
  });

  it("allows ignored runtime artifacts in an otherwise clean worktree", async () => {
    const fixture = await createFixture();
    fs.mkdirSync(path.join(fixture.worktree, "runtime"));
    fs.writeFileSync(path.join(fixture.worktree, "runtime", "agent.log"), "generated log\n");

    expect(await mergeWorktree(fixture.repo, "feature/task", fixture.worktree, { defaultBranch: "develop" }))
      .toMatchObject({ merged: true });
    expect(fs.existsSync(fixture.worktree)).toBe(false);
  });
});
