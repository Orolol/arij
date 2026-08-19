import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Command-level contract of the clone service: exactly which arguments reach
 * `git`, and how its stderr maps to a CloneError code. `simple-git` is mocked
 * here — the real-git behaviour lives in git-clone-service.test.ts.
 */

const gitMock = vi.hoisted(() => {
  const git: Record<string, ReturnType<typeof vi.fn>> = {};
  git.raw = vi.fn().mockResolvedValue("");
  git.env = vi.fn(() => git);
  git.branchLocal = vi.fn().mockResolvedValue({ current: "main", all: ["main"] });
  return git;
});

vi.mock("simple-git", () => ({
  default: vi.fn(() => gitMock),
  CheckRepoActions: { IS_REPO_ROOT: "root" },
}));

import { CloneError, cloneRepository, type CloneErrorCode } from "@/lib/git/clone";

const PAT = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const CLONE_URL = "https://github.com/octocat/hello-world.git";

let root: string;

function dest(name = "octocat-hello-world"): string {
  return path.join(root, name);
}

function cloneArgs(): string[] {
  return gitMock.raw.mock.calls[0][0] as string[];
}

beforeEach(() => {
  vi.clearAllMocks();
  gitMock.raw.mockResolvedValue("");
  gitMock.env.mockImplementation(() => gitMock);
  gitMock.branchLocal.mockResolvedValue({ current: "main", all: ["main"] });
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arij-clone-cmd-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("clone command", () => {
  it("clones with full history and no credentials for a public repo", async () => {
    await cloneRepository({ cloneUrl: CLONE_URL, dest: dest() });

    expect(cloneArgs()).toEqual(["clone", "--", CLONE_URL, dest()]);
    expect(cloneArgs().join(" ")).not.toContain("--depth");
    expect(cloneArgs().join(" ")).not.toContain("--single-branch");
    expect(cloneArgs().join(" ")).not.toContain("extraHeader");
  });

  it("injects the PAT as an http.extraHeader via -c", async () => {
    await cloneRepository({ cloneUrl: CLONE_URL, dest: dest(), token: PAT });

    const args = cloneArgs();
    expect(args[0]).toBe("-c");
    expect(args[1]).toMatch(/^http\.extraHeader=Authorization: Basic /);

    const basic = args[1].replace("http.extraHeader=Authorization: Basic ", "");
    expect(Buffer.from(basic, "base64").toString("utf-8")).toBe(
      `x-access-token:${PAT}`
    );
    // The header is config for THIS command only — never `git config`, and
    // never baked into the remote URL.
    expect(args).toContain("clone");
    expect(args).toContain(CLONE_URL);
    expect(args.join(" ")).not.toContain(`${PAT}@`);
  });

  it("checks out an explicit branch", async () => {
    gitMock.branchLocal.mockResolvedValue({ current: "develop", all: ["develop"] });

    const result = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      branch: "develop",
    });

    expect(cloneArgs()).toEqual(["clone", "--branch", "develop", "--", CLONE_URL, dest()]);
    expect(result.defaultBranch).toBe("develop");
  });

  it("disables interactive credential prompts", async () => {
    await cloneRepository({ cloneUrl: CLONE_URL, dest: dest() });

    expect(gitMock.env).toHaveBeenCalledWith(
      expect.objectContaining({ GIT_TERMINAL_PROMPT: "0" })
    );
  });

  it("passes the token only when there is one to pass", async () => {
    await cloneRepository({ cloneUrl: CLONE_URL, dest: dest("a") });
    expect(cloneArgs()).not.toContain("-c");

    for (const token of [null, undefined, "", "   "]) {
      gitMock.raw.mockClear();
      await cloneRepository({ cloneUrl: CLONE_URL, dest: dest(`t-${token}`), token });

      // A blank PAT is "no PAT": sending `Basic ` with an empty payload would
      // turn a public clone into an authentication failure.
      expect(gitMock.raw.mock.calls[0][0]).not.toContain("-c");
    }
  });
});

describe("clone cleanup", () => {
  /** Mimics git: the destination appears, then the command fails. */
  function failingClone(message: string) {
    gitMock.raw.mockImplementation(async (args: string[]) => {
      const target = args[args.length - 1];
      fs.mkdirSync(path.join(target, ".git"), { recursive: true });
      fs.writeFileSync(path.join(target, ".git", "HEAD"), "ref: refs/heads/main");
      throw new Error(message);
    });
  }

  it("removes the partial destination when the clone fails", async () => {
    failingClone("fatal: the remote end hung up unexpectedly");

    await expect(
      cloneRepository({ cloneUrl: CLONE_URL, dest: dest() })
    ).rejects.toBeInstanceOf(CloneError);

    // A half-written tree left behind would be picked up as a "matching"
    // clone on the next attempt and reused instead of re-cloned.
    expect(fs.existsSync(dest())).toBe(false);
  });

  it("removes the partial destination when the clone times out", async () => {
    gitMock.raw.mockImplementation(async (args: string[]) => {
      fs.mkdirSync(args[args.length - 1], { recursive: true });
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new Error("aborted");
    });

    await expect(
      cloneRepository({ cloneUrl: CLONE_URL, dest: dest(), timeoutMs: 10 })
    ).rejects.toMatchObject({ code: "timeout" });

    expect(fs.existsSync(dest())).toBe(false);
  });

  it("leaves the parent root in place after a failure", async () => {
    failingClone("fatal: repository not found");

    await expect(
      cloneRepository({ cloneUrl: CLONE_URL, dest: dest() })
    ).rejects.toBeInstanceOf(CloneError);

    // Only the clone's own directory is ours to delete.
    expect(fs.existsSync(root)).toBe(true);
  });

  it("never deletes a directory it did not create", async () => {
    // A pre-existing destination goes down the reuse path, which either
    // fetches or conflicts — it must never be cleaned up as "partial".
    const occupied = dest("occupied");
    fs.mkdirSync(occupied, { recursive: true });
    fs.writeFileSync(path.join(occupied, "IMPORTANT.txt"), "user data");
    gitMock.checkIsRepo = vi.fn().mockResolvedValue(false);

    await expect(
      cloneRepository({ cloneUrl: CLONE_URL, dest: occupied })
    ).rejects.toMatchObject({ code: "conflict" });

    expect(fs.readFileSync(path.join(occupied, "IMPORTANT.txt"), "utf-8")).toBe(
      "user data"
    );
    // And git was never asked to clone into it.
    expect(gitMock.raw).not.toHaveBeenCalled();
  });
});

describe("clone failure classification", () => {
  const cases: Array<[string, string, CloneErrorCode]> = [
    [
      "missing or private repository",
      "remote: Repository not found.\nfatal: repository 'https://github.com/octocat/hello-world.git/' not found",
      "not_found",
    ],
    [
      "private repository with no token",
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
      "not_found",
    ],
    [
      "rejected credentials",
      "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/octocat/hello-world.git/'",
      "auth_failed",
    ],
    [
      "token without access",
      "fatal: unable to access 'https://github.com/octocat/hello-world.git/': The requested URL returned error: 403 Forbidden",
      "auth_failed",
    ],
    [
      "DNS failure",
      "fatal: unable to access 'https://github.com/octocat/hello-world.git/': Could not resolve host: github.com",
      "network",
    ],
    [
      "unreachable host",
      "fatal: unable to access 'https://github.com/octocat/hello-world.git/': Failed to connect to github.com port 443: Connection refused",
      "network",
    ],
    [
      "unknown branch",
      "fatal: Remote branch nope not found in upstream origin",
      "branch_not_found",
    ],
    ["anything else", "error: RPC failed; curl 92 HTTP/2 stream 5 was reset", "clone_failed"],
  ];

  it.each(cases)("maps %s to %s", async (_label, stderr, code) => {
    gitMock.raw.mockRejectedValue(new Error(stderr));

    const error = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      branch: code === "branch_not_found" ? "nope" : null,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(CloneError);
    expect(error.code).toBe(code);
  });

  it("tells the user to add a PAT when none was configured", async () => {
    gitMock.raw.mockRejectedValue(
      new Error("remote: Repository not found.\nfatal: repository not found")
    );

    const error = await cloneRepository({ cloneUrl: CLONE_URL, dest: dest() }).catch(
      (e) => e
    );

    expect(error.message).toContain("Settings → GitHub PAT");
  });

  it("blames the configured PAT when one was used", async () => {
    gitMock.raw.mockRejectedValue(
      new Error("remote: Repository not found.\nfatal: repository not found")
    );

    const error = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      token: PAT,
    }).catch((e) => e);

    expect(error.message).toContain("does not grant access");
    expect(error.message).not.toContain(PAT);
  });

  it("keeps the PAT out of the error, whatever git printed", async () => {
    const basic = Buffer.from(`x-access-token:${PAT}`).toString("base64");
    gitMock.raw.mockRejectedValue(
      new Error(
        `error running: git -c http.extraHeader=Authorization: Basic ${basic} clone\n` +
          `fatal: could not read from 'https://x-access-token:${PAT}@github.com/octocat/hello-world.git'`
      )
    );

    const error = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      token: PAT,
    }).catch((e) => e);

    const serialized = `${error.message} ${JSON.stringify(error.details)}`;
    expect(serialized).not.toContain(PAT);
    expect(serialized).not.toContain(basic);
  });
});

/**
 * The reuse path talks to the remote just like the clone path does. It is the
 * easy one to get wrong: the token is deliberately absent from `.git/config`,
 * so a fetch that does not re-supply it is unauthenticated — which for a
 * private repository means a credential prompt, and with no terminal attached
 * that is a hang rather than an error.
 */
describe("reuse transport", () => {
  /** An existing destination holding the same repository. */
  function reusableDestination(name = "octocat-hello-world"): string {
    const target = dest(name);
    fs.mkdirSync(target, { recursive: true });
    gitMock.checkIsRepo = vi.fn().mockResolvedValue(true);
    gitMock.getRemotes = vi.fn().mockResolvedValue([
      { name: "origin", refs: { fetch: CLONE_URL, push: CLONE_URL } },
    ]);
    return target;
  }

  function fetchArgs(): string[] {
    const call = gitMock.raw.mock.calls.find((args) =>
      (args[0] as string[]).includes("fetch")
    );
    if (!call) throw new Error("git never fetched");
    return call[0] as string[];
  }

  it("re-supplies the PAT on the fetch", async () => {
    const target = reusableDestination();

    const result = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: target,
      token: PAT,
      expectedOwnerRepo: "octocat/hello-world",
    });

    expect(result.reused).toBe(true);

    const args = fetchArgs();
    expect(args[0]).toBe("-c");
    expect(args[1]).toMatch(/^http\.extraHeader=Authorization: Basic /);
    expect(args.slice(2)).toEqual(["fetch", "origin"]);

    const basic = args[1].replace("http.extraHeader=Authorization: Basic ", "");
    expect(Buffer.from(basic, "base64").toString("utf-8")).toBe(
      `x-access-token:${PAT}`
    );
  });

  it("fetches unauthenticated when there is no PAT", async () => {
    const target = reusableDestination();

    await cloneRepository({ cloneUrl: CLONE_URL, dest: target });

    expect(fetchArgs()).toEqual(["fetch", "origin"]);
  });

  it("disables interactive credential prompts on the fetch", async () => {
    const target = reusableDestination();

    await cloneRepository({ cloneUrl: CLONE_URL, dest: target, token: PAT });

    expect(gitMock.env).toHaveBeenCalledWith(
      expect.objectContaining({ GIT_TERMINAL_PROMPT: "0" })
    );
  });

  it("bounds the fetch with the clone timeout instead of hanging", async () => {
    const target = reusableDestination();
    gitMock.raw.mockImplementation(async (args: string[]) => {
      if (!args.includes("fetch")) return "";
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new Error("aborted");
    });

    await expect(
      cloneRepository({ cloneUrl: CLONE_URL, dest: target, timeoutMs: 10 })
    ).rejects.toMatchObject({ code: "timeout" });

    // The destination was the user's before this call and stays untouched: a
    // failed *fetch* is not a partial clone.
    expect(fs.existsSync(target)).toBe(true);
  });

  it("keeps the PAT out of a failed fetch's error", async () => {
    const target = reusableDestination();
    gitMock.raw.mockImplementation(async (args: string[]) => {
      if (!args.includes("fetch")) return "";
      throw new Error(
        `fatal: could not read from 'https://x-access-token:${PAT}@github.com/octocat/hello-world.git'`
      );
    });

    const error = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: target,
      token: PAT,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(CloneError);
    expect(`${error.message} ${JSON.stringify(error.details)}`).not.toContain(PAT);
  });

  it("reports the remote's default branch, not whatever is checked out", async () => {
    const target = reusableDestination();
    // The user left this clone on a feature branch. Persisting that as the
    // project's default branch would send every later worktree to the wrong
    // base, so `origin/HEAD` wins.
    gitMock.branchLocal.mockResolvedValue({
      current: "feature/wip",
      all: ["feature/wip", "trunk"],
    });
    gitMock.raw.mockImplementation(async (args: string[]) =>
      args.includes("symbolic-ref") ? "origin/trunk\n" : ""
    );

    const result = await cloneRepository({ cloneUrl: CLONE_URL, dest: target });

    expect(result).toMatchObject({ reused: true, defaultBranch: "trunk" });
  });

  it("falls back to the checked-out branch when the remote advertises no HEAD", async () => {
    const target = reusableDestination();
    gitMock.branchLocal.mockResolvedValue({ current: "main", all: ["main"] });
    gitMock.raw.mockImplementation(async (args: string[]) => {
      if (args.includes("symbolic-ref")) throw new Error("fatal: ref not a symbolic ref");
      return "";
    });

    const result = await cloneRepository({ cloneUrl: CLONE_URL, dest: target });

    expect(result.defaultBranch).toBe("main");
  });
});
