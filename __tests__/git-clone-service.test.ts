import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import simpleGit from "simple-git";
import { CloneError, cloneRepository } from "@/lib/git/clone";
import { isGitRepo } from "@/lib/git/manager";

/**
 * Integration tests for the clone service against REAL git: a `file://`
 * source repository stands in for GitHub, so every claim about the resulting
 * clone (full history, clean origin, no secret on disk) is checked on an
 * actual work tree rather than on a mock's call arguments.
 */

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Source repo with 2 commits on `main` plus a `feature/extra` branch. */
async function createSourceRepo(name = "arij-clone-src-") {
  const dir = tempDir(name);
  const git = simpleGit(dir);

  await git.init();
  await git.addConfig("user.name", "Arij Test");
  await git.addConfig("user.email", "arij@example.com");
  await git.addConfig("commit.gpgsign", "false");

  fs.writeFileSync(path.join(dir, "README.md"), "# Test\n", "utf-8");
  await git.add(["README.md"]);
  await git.commit("chore: initial");
  await git.branch(["-M", "main"]);

  fs.writeFileSync(path.join(dir, "second.md"), "second\n", "utf-8");
  await git.add(["second.md"]);
  await git.commit("chore: second");

  await git.checkoutLocalBranch("feature/extra");
  fs.writeFileSync(path.join(dir, "feature.md"), "feature\n", "utf-8");
  await git.add(["feature.md"]);
  await git.commit("feat: extra");
  await git.checkout("main");

  return { dir, git, url: `file://${dir}` };
}

async function commitTo(repoDir: string, file: string, message: string) {
  const git = simpleGit(repoDir);
  fs.writeFileSync(path.join(repoDir, file), `${file}\n`, "utf-8");
  await git.add([file]);
  await git.commit(message);
}

function destinationIn(root: string, name = "owner-repo"): string {
  return path.join(root, name);
}

/** Every file under `.git`, read as text — used to prove no secret landed. */
function readGitDirFiles(repoPath: string): string[] {
  const contents: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        try {
          contents.push(fs.readFileSync(full, "utf-8"));
        } catch {
          // binary/unreadable object files cannot hold the header anyway
        }
      }
    }
  };
  walk(path.join(repoPath, ".git"));
  return contents;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("cloneRepository — fresh clone", () => {
  it("clones into the destination and reports the checked-out branch", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));

    const result = await cloneRepository({ cloneUrl: source.url, dest });

    expect(result).toMatchObject({ path: dest, reused: false, defaultBranch: "main" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(await isGitRepo(dest)).toBe(true);
    expect(fs.existsSync(path.join(dest, "README.md"))).toBe(true);
  });

  it("keeps the full history — no shallow clone, no single branch", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));

    await cloneRepository({ cloneUrl: source.url, dest });

    const git = simpleGit(dest);
    const commitCount = (await git.raw(["rev-list", "--count", "HEAD"])).trim();
    expect(commitCount).toBe("2");
    // `--depth` would have left a shallow marker...
    expect(fs.existsSync(path.join(dest, ".git", "shallow"))).toBe(false);
    // ...and `--single-branch` would have dropped the other branch's ref.
    const remoteBranches = await git.raw(["branch", "-r"]);
    expect(remoteBranches).toContain("origin/feature/extra");
    // Worktrees are created off main, so that ref must be reachable.
    await expect(git.revparse(["origin/main"])).resolves.toBeTruthy();
  });

  it("leaves origin pointing at the clean URL", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));

    await cloneRepository({ cloneUrl: source.url, dest });

    const remotes = await simpleGit(dest).getRemotes(true);
    expect(remotes).toHaveLength(1);
    expect(remotes[0]).toMatchObject({ name: "origin" });
    expect(remotes[0].refs.fetch).toBe(source.url);
  });

  it("checks out an explicitly requested branch and reports it", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));

    const result = await cloneRepository({
      cloneUrl: source.url,
      dest,
      branch: "feature/extra",
    });

    expect(result.defaultBranch).toBe("feature/extra");
    expect(fs.existsSync(path.join(dest, "feature.md"))).toBe(true);
  });

  it("creates the clone root when it does not exist yet", async () => {
    const source = await createSourceRepo();
    const root = path.join(tempDir("arij-clone-root-"), "nested", "projects");
    const dest = destinationIn(root);

    await cloneRepository({ cloneUrl: source.url, dest });

    expect(await isGitRepo(dest)).toBe(true);
  });

  it("never writes the token to disk", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));
    const token = `ghp_${"S3CRETtoken".repeat(2)}`;

    await cloneRepository({ cloneUrl: source.url, dest, token });

    const gitFiles = readGitDirFiles(dest);
    expect(gitFiles.some((content) => content.includes(token))).toBe(false);
    expect(
      gitFiles.some((content) => content.toLowerCase().includes("extraheader"))
    ).toBe(false);

    // origin stays credential-free, so the user's own git keeps working.
    const config = fs.readFileSync(path.join(dest, ".git", "config"), "utf-8");
    expect(config).toContain(source.url);
    expect(config).not.toContain("Authorization");
  });

  it("leaves a working clone: fetch keeps succeeding afterwards", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));

    await cloneRepository({ cloneUrl: source.url, dest, token: "ghp_token_value" });
    await commitTo(source.dir, "third.md", "chore: third");

    await expect(simpleGit(dest).fetch("origin")).resolves.toBeTruthy();
    const remoteHead = await simpleGit(dest).revparse(["origin/main"]);
    const sourceHead = await simpleGit(source.dir).revparse(["HEAD"]);
    expect(remoteHead.trim()).toBe(sourceHead.trim());
  });
});

describe("cloneRepository — reuse", () => {
  it("reuses an existing clone of the same repo and fetches it", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));

    const first = await cloneRepository({ cloneUrl: source.url, dest });
    expect(first.reused).toBe(false);

    // A commit that only a fetch can bring in.
    await commitTo(source.dir, "third.md", "chore: third");

    const second = await cloneRepository({ cloneUrl: source.url, dest });

    expect(second).toMatchObject({ path: dest, reused: true, defaultBranch: "main" });
    const remoteHead = await simpleGit(dest).revparse(["origin/main"]);
    const sourceHead = await simpleGit(source.dir).revparse(["HEAD"]);
    expect(remoteHead.trim()).toBe(sourceHead.trim());
  });

  it("does not re-download: the existing work tree is left untouched", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));

    await cloneRepository({ cloneUrl: source.url, dest });
    // A local artefact a re-clone would have wiped.
    fs.writeFileSync(path.join(dest, "local-scratch.txt"), "keep me", "utf-8");
    const headBefore = await simpleGit(dest).revparse(["HEAD"]);

    const result = await cloneRepository({ cloneUrl: source.url, dest });

    expect(result.reused).toBe(true);
    expect(fs.readFileSync(path.join(dest, "local-scratch.txt"), "utf-8")).toBe("keep me");
    expect(await simpleGit(dest).revparse(["HEAD"])).toBe(headBefore);
  });

  it("serializes two concurrent clones of the same destination", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));

    const [a, b] = await Promise.all([
      cloneRepository({ cloneUrl: source.url, dest }),
      cloneRepository({ cloneUrl: source.url, dest }),
    ]);

    // One cloned, the other waited and took the reuse path — never both.
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect(await isGitRepo(dest)).toBe(true);
    expect((await simpleGit(dest).raw(["rev-list", "--count", "HEAD"])).trim()).toBe("2");
  });
});

describe("cloneRepository — conflicts", () => {
  it("refuses a destination holding a different repository", async () => {
    const source = await createSourceRepo();
    const other = await createSourceRepo("arij-clone-other-");
    const dest = destinationIn(tempDir("arij-clone-root-"));

    await cloneRepository({ cloneUrl: other.url, dest });

    const error = await cloneRepository({ cloneUrl: source.url, dest }).catch((e) => e);

    expect(error).toBeInstanceOf(CloneError);
    expect(error.code).toBe("conflict");
    expect(error.message).toContain(dest);
    expect(error.message).toContain(other.url);
    // Nothing was touched.
    expect(await isGitRepo(dest)).toBe(true);
    expect((await simpleGit(dest).getRemotes(true))[0].refs.fetch).toBe(other.url);
  });

  it("refuses a destination that exists but is not a git repository", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "keep.txt"), "keep", "utf-8");

    const error = await cloneRepository({ cloneUrl: source.url, dest }).catch((e) => e);

    expect(error).toBeInstanceOf(CloneError);
    expect(error.code).toBe("conflict");
    expect(error.message).toContain(dest);
    expect(fs.readFileSync(path.join(dest, "keep.txt"), "utf-8")).toBe("keep");
  });

  it("refuses an empty directory that merely sits inside another repo", async () => {
    // Dogfooding case: <arij>/projects/<owner>-<repo> is itself inside a git
    // repo, so a naive `checkIsRepo()` would report the empty directory as a
    // repository and 'reuse' Arij's own checkout.
    const source = await createSourceRepo();
    const outerRepo = await createSourceRepo("arij-clone-outer-");
    const dest = path.join(outerRepo.dir, "projects", "owner-repo");
    fs.mkdirSync(dest, { recursive: true });

    const error = await cloneRepository({ cloneUrl: source.url, dest }).catch((e) => e);

    expect(error).toBeInstanceOf(CloneError);
    expect(error.code).toBe("conflict");
  });

  it("reuses a clone whose GitHub owner/repo matches even when the URL differs", async () => {
    // An `ssh://` clone made by hand and an `https://` import URL are the same
    // repository: identity is owner/repo, not the literal remote string.
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));

    await cloneRepository({ cloneUrl: source.url, dest });
    // Keep origin on the local fixture (so the fetch stays offline) and add
    // the GitHub identity on a second remote, as a hand-made clone often has.
    await simpleGit(dest).addRemote("github", "git@github.com:octocat/hello-world.git");

    const result = await cloneRepository({
      cloneUrl: "https://github.com/octocat/hello-world.git",
      dest,
      expectedOwnerRepo: "octocat/hello-world",
    });

    expect(result).toMatchObject({ path: dest, reused: true });
  });
});

describe("cloneRepository — failures", () => {
  it("maps a missing repository to not_found and leaves no directory behind", async () => {
    const root = tempDir("arij-clone-root-");
    const dest = destinationIn(root);

    const error = await cloneRepository({
      cloneUrl: `file://${path.join(root, "does-not-exist")}`,
      dest,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(CloneError);
    expect(error.code).toBe("not_found");
    expect(error.message).toContain("GitHub PAT");
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("names the branch when it does not exist, and cleans up", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));

    const error = await cloneRepository({
      cloneUrl: source.url,
      dest,
      branch: "no-such-branch",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(CloneError);
    expect(error.code).toBe("branch_not_found");
    expect(error.message).toContain("no-such-branch");
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("aborts a clone that exceeds the timeout", async () => {
    const source = await createSourceRepo();
    const dest = destinationIn(tempDir("arij-clone-root-"));

    const error = await cloneRepository({
      cloneUrl: source.url,
      dest,
      timeoutMs: 1,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(CloneError);
    expect(error.code).toBe("timeout");
    expect(fs.existsSync(dest)).toBe(false);
  });

  it("rejects option-shaped input instead of passing it to git", async () => {
    const dest = destinationIn(tempDir("arij-clone-root-"));

    await expect(
      cloneRepository({ cloneUrl: "--upload-pack=touch /tmp/pwned", dest })
    ).rejects.toMatchObject({ code: "invalid_input" });

    const source = await createSourceRepo();
    await expect(
      cloneRepository({ cloneUrl: source.url, dest, branch: "--config=core.pager=id" })
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(fs.existsSync(dest)).toBe(false);
  });
});
