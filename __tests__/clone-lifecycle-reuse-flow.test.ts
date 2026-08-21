import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Story: "As a user whose import was interrupted, I want to resume from the
 * existing clone" — the decision the service makes about an existing
 * destination, and specifically that reuse does NOT re-download.
 *
 * git itself is mocked here so the assertions can be about which git command
 * ran (`fetch` vs `clone`); the on-disk classification that feeds those
 * decisions is covered against real repositories in
 * clone-lifecycle-resume.test.ts.
 */

const gitRaw = vi.hoisted(() => vi.fn());
const getRemotes = vi.hoisted(() => vi.fn());

vi.mock("simple-git", () => ({
  default: vi.fn(() => ({ raw: gitRaw, getRemotes })),
}));

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  CloneConflictError,
  CloneFailedError,
  buildAuthHeaderConfig,
  cloneGitHubRepository,
} from "@/lib/git/clone";

let tmpRoot: string;
let destination: string;

const TOKEN = "ghp_0123456789abcdefghijABCDEFGHIJ";

/** Every `raw()` invocation, flattened for readable assertions. */
function rawCalls(): string[][] {
  return gitRaw.mock.calls.map(([args]) => args as string[]);
}

function calledWith(subcommand: string): string[][] {
  return rawCalls().filter((args) => args.includes(subcommand));
}

/**
 * Stands in for git's own side effects: `clone` creates the directory it was
 * given, with a `.git` inside it. The service stages downloads in a temporary
 * directory and renames it into place, so a mock that produced nothing would
 * fail at the rename rather than exercising the path under test.
 */
function fakeGit(options: { head?: boolean } = {}) {
  const { head = true } = options;
  return async (args: string[]) => {
    if (args.includes("clone")) {
      const target = args[args.length - 1];
      fs.mkdirSync(path.join(target, ".git"), { recursive: true });
      return "";
    }
    if (args.includes("--verify") && !head) throw new Error("unborn HEAD");
    if (args.includes("--abbrev-ref")) return "main\n";
    return "";
  };
}

/** Stamps the marker the service writes into clones it created. */
function markAsArijClone(repoPath: string, owner = "owner", repo = "repo") {
  fs.mkdirSync(path.join(repoPath, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(repoPath, ".git", "arij-clone.json"),
    JSON.stringify({
      version: 1,
      owner,
      repo,
      ownerRepo: `${owner}/${repo}`,
      remoteUrl: `https://github.com/${owner}/${repo}.git`,
      createdAt: new Date().toISOString(),
    })
  );
}

/** Makes `origin` resolve to the given URL, and HEAD look checked out. */
function existingCloneOf(remoteUrl: string, options: { head?: boolean } = {}) {
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "README.md"), "x");
  getRemotes.mockResolvedValue([
    { name: "origin", refs: { fetch: remoteUrl, push: remoteUrl } },
  ]);
  gitRaw.mockImplementation(fakeGit(options));
}

/** Staging directories the service leaves behind, if any. */
function tempDirsInRoot(): string[] {
  const parent = path.dirname(destination);
  if (!fs.existsSync(parent)) return [];
  return fs
    .readdirSync(parent)
    .filter((entry) => entry.startsWith(".arij-clone-tmp-"));
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arij-clone-flow-"));
  destination = path.join(tmpRoot, "projects", "owner-repo");
  getRemotes.mockResolvedValue([]);
  gitRaw.mockImplementation(fakeGit());
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("cloneGitHubRepository — fresh clone", () => {
  it("clones with the full history and records the clean remote", async () => {
    const result = await cloneGitHubRepository({
      input: "https://github.com/owner/repo",
      destination,
    });

    expect(result.reused).toBe(false);
    expect(result.ownerRepo).toBe("owner/repo");
    expect(result.remoteUrl).toBe("https://github.com/owner/repo.git");
    expect(result.defaultBranch).toBe("main");

    const clone = calledWith("clone");
    expect(clone).toHaveLength(1);
    // Worktrees, merge-base and tagging all need real history.
    expect(clone[0]).not.toContain("--depth");
    expect(clone[0]).not.toContain("--single-branch");
    expect(clone[0]).toContain("https://github.com/owner/repo.git");
  });

  it("passes the token as a one-shot config value, never in the remote URL", async () => {
    await cloneGitHubRepository({
      input: "owner/repo",
      destination,
      token: TOKEN,
    });

    const [args] = calledWith("clone");
    expect(args[0]).toBe("-c");
    expect(args[1]).toBe(buildAuthHeaderConfig(TOKEN));
    expect(args[1]).toContain(
      Buffer.from(`x-access-token:${TOKEN}`).toString("base64")
    );
    // The URL git writes into .git/config carries no credentials.
    expect(args).toContain("https://github.com/owner/repo.git");
    expect(args.join(" ")).not.toContain(`${TOKEN}@`);
  });

  it("sends no credentials at all for a public repository", async () => {
    await cloneGitHubRepository({ input: "owner/repo", destination });

    const [args] = calledWith("clone");
    expect(args[0]).toBe("clone");
    expect(args.join(" ")).not.toContain("Authorization");
  });

  it("rejects input that is not a GitHub repository", async () => {
    await expect(
      cloneGitHubRepository({ input: "https://example.com/nope", destination })
    ).rejects.toBeInstanceOf(CloneFailedError);
    expect(calledWith("clone")).toHaveLength(0);
  });
});

describe("cloneGitHubRepository — resuming an interrupted import", () => {
  it("reuses a healthy clone: fetches, never re-downloads", async () => {
    existingCloneOf("https://github.com/owner/repo.git");

    const result = await cloneGitHubRepository({
      input: "https://github.com/owner/repo",
      destination,
    });

    expect(result.reused).toBe(true);
    expect(result.destinationState).toBe("healthy_match");
    expect(calledWith("clone")).toHaveLength(0);
    expect(calledWith("fetch")).toHaveLength(1);
    // The clone survives untouched — this is what makes resume instant.
    expect(fs.existsSync(path.join(destination, "README.md"))).toBe(true);
  });

  it("reuses a clone reached through a different remote URL form", async () => {
    existingCloneOf("git@github.com:owner/repo.git");

    const result = await cloneGitHubRepository({
      input: "https://github.com/owner/repo/tree/main",
      destination,
    });

    expect(result.reused).toBe(true);
    expect(calledWith("clone")).toHaveLength(0);
  });

  it("keeps the clone usable when the reuse fetch fails (offline, expired token)", async () => {
    existingCloneOf("https://github.com/owner/repo.git");
    gitRaw.mockImplementation(async (args: string[]) => {
      if (args.includes("fetch")) throw new Error("could not resolve host");
      if (args.includes("--abbrev-ref")) return "main\n";
      return "";
    });

    const result = await cloneGitHubRepository({
      input: "owner/repo",
      destination,
    });

    expect(result.reused).toBe(true);
    expect(fs.existsSync(destination)).toBe(true);
  });

  it("replaces its own marked debris instead of reporting a conflict", async () => {
    // Right origin, nothing checked out, and Arij's marker: a clone of ours
    // killed mid-transfer, so replacing it destroys nothing but our own mess.
    existingCloneOf("https://github.com/owner/repo.git", { head: false });
    markAsArijClone(destination);

    const result = await cloneGitHubRepository({
      input: "owner/repo",
      destination,
    });

    expect(result.destinationState).toBe("arij_debris");
    expect(result.reused).toBe(false);
    expect(calledWith("clone")).toHaveLength(1);
    expect(fs.existsSync(path.join(destination, "README.md"))).toBe(false);
  });

  it("refuses unmarked debris rather than deleting it", async () => {
    // Identical on disk to the case above, minus the marker. It is just as
    // likely to be a repository somebody initialised by hand and has not
    // committed to yet, and Arij has no way to tell — so it keeps its hands off.
    existingCloneOf("https://github.com/owner/repo.git", { head: false });

    await expect(
      cloneGitHubRepository({ input: "owner/repo", destination })
    ).rejects.toBeInstanceOf(CloneConflictError);

    expect(calledWith("clone")).toHaveLength(0);
    expect(fs.existsSync(path.join(destination, "README.md"))).toBe(true);
  });

  it("refuses a leftover directory that is not a git repository", async () => {
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "notes.txt"), "my work");
    getRemotes.mockRejectedValue(new Error("not a git repository"));

    const error: unknown = await cloneGitHubRepository({
      input: "owner/repo",
      destination,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CloneConflictError);
    expect((error as CloneConflictError).state).toBe("foreign_content");
    expect(calledWith("clone")).toHaveLength(0);
    expect(fs.readFileSync(path.join(destination, "notes.txt"), "utf-8")).toBe(
      "my work"
    );
  });

  it("clones into an existing empty directory", async () => {
    fs.mkdirSync(destination, { recursive: true });

    const result = await cloneGitHubRepository({
      input: "owner/repo",
      destination,
    });

    expect(result.destinationState).toBe("empty");
    expect(calledWith("clone")).toHaveLength(1);
    expect(fs.existsSync(destination)).toBe(true);
  });

  it("stamps a fresh clone as Arij-managed", async () => {
    const result = await cloneGitHubRepository({
      input: "owner/repo",
      destination,
    });

    expect(result.managed).toBe(true);
    const marker = JSON.parse(
      fs.readFileSync(path.join(destination, ".git", "arij-clone.json"), "utf-8")
    );
    expect(marker).toMatchObject({
      version: 1,
      owner: "owner",
      repo: "repo",
      remoteUrl: "https://github.com/owner/repo.git",
    });
  });

  it("does not claim a pre-existing clone it merely reused", async () => {
    // The user's own checkout, at the path Arij would have chosen. Reusing it is
    // free; claiming the right to delete it later is not.
    existingCloneOf("https://github.com/owner/repo.git");

    const result = await cloneGitHubRepository({
      input: "owner/repo",
      destination,
    });

    expect(result.reused).toBe(true);
    expect(result.managed).toBe(false);
    expect(
      fs.existsSync(path.join(destination, ".git", "arij-clone.json"))
    ).toBe(false);
  });
});

describe("cloneGitHubRepository — conflicts and failures", () => {
  it("refuses to overwrite a clone of a different repository", async () => {
    existingCloneOf("https://github.com/someone-else/other.git");

    await expect(
      cloneGitHubRepository({ input: "owner/repo", destination })
    ).rejects.toBeInstanceOf(CloneConflictError);

    expect(calledWith("clone")).toHaveLength(0);
    // Nothing was deleted.
    expect(fs.existsSync(path.join(destination, "README.md"))).toBe(true);
  });

  it("carries the existing remote on the conflict for the UI", async () => {
    existingCloneOf("https://github.com/someone-else/other.git");

    const error: unknown = await cloneGitHubRepository({
      input: "owner/repo",
      destination,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CloneConflictError);
    const conflict = error as CloneConflictError;
    expect(conflict.code).toBe("clone_destination_conflict");
    expect(conflict.existingRemote).toBe("someone-else/other");
    expect(conflict.destination).toBe(destination);
  });

  it("leaves no debris at the destination when git fails part-way", async () => {
    gitRaw.mockImplementation(async (args: string[]) => {
      if (args.includes("clone")) {
        const target = args[args.length - 1];
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, "partial.pack"), "x");
        throw new Error("early EOF");
      }
      return "";
    });

    await expect(
      cloneGitHubRepository({ input: "owner/repo", destination })
    ).rejects.toBeInstanceOf(CloneFailedError);

    // The download never touched the destination — it happened in a staging
    // directory, which is cleaned up on the way out.
    expect(fs.existsSync(destination)).toBe(false);
    expect(tempDirsInRoot()).toEqual([]);
  });

  it("sweeps a staging directory abandoned by a killed process", async () => {
    const stale = path.join(
      path.dirname(destination),
      ".arij-clone-tmp-owner-repo-deadbeef"
    );
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, "half.pack"), "x");

    await cloneGitHubRepository({ input: "owner/repo", destination });

    expect(fs.existsSync(stale)).toBe(false);
    expect(tempDirsInRoot()).toEqual([]);
  });

  it("serialises concurrent clones of the same destination", async () => {
    // Unserialised, both callers classify an absent destination and both clone;
    // then the loser's failure handler tidies up the winner's directory.
    let inFlight = 0;
    let overlapped = false;

    // Once the first clone lands, `origin` reads back like a real one would.
    getRemotes.mockResolvedValue([
      {
        name: "origin",
        refs: {
          fetch: "https://github.com/owner/repo.git",
          push: "https://github.com/owner/repo.git",
        },
      },
    ]);

    gitRaw.mockImplementation(async (args: string[]) => {
      if (args.includes("clone")) {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        fs.mkdirSync(path.join(args[args.length - 1], ".git"), {
          recursive: true,
        });
        inFlight -= 1;
        return "";
      }
      if (args.includes("--abbrev-ref")) return "main\n";
      return "";
    });

    const results = await Promise.all([
      cloneGitHubRepository({ input: "owner/repo", destination }),
      cloneGitHubRepository({ input: "owner/repo", destination }),
    ]);

    expect(overlapped).toBe(false);
    // The first call downloads; the second finds a complete clone of the same
    // repository waiting for it and reuses it rather than racing it.
    expect(calledWith("clone")).toHaveLength(1);
    expect(results.map((r) => r.reused).sort()).toEqual([false, true]);
    expect(fs.existsSync(destination)).toBe(true);
    expect(tempDirsInRoot()).toEqual([]);
  });

  it("redacts the token from a git failure message", async () => {
    const header = buildAuthHeaderConfig(TOKEN);
    gitRaw.mockImplementation(async (args: string[]) => {
      if (args.includes("clone")) {
        throw new Error(`fatal: failed running: git -c ${header} clone ...`);
      }
      return "";
    });

    const error: unknown = await cloneGitHubRepository({
      input: "owner/repo",
      destination,
      token: TOKEN,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CloneFailedError);
    const { message } = error as Error;
    const encoded = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
    expect(message).not.toContain(encoded);
    expect(message).not.toContain(TOKEN);
    expect(message).toContain("[redacted]");
  });
});
