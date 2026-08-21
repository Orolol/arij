import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Command-level contract of the clone service: exactly which arguments reach
 * `git`, when the stored PAT is (and is not) replayed, and how git's stderr
 * maps to a CloneError code. `simple-git` is mocked here — the real-git
 * behaviour lives in git-clone-service.test.ts.
 */

const gitMock = vi.hoisted(() => {
  const git: Record<string, ReturnType<typeof vi.fn>> = {};
  git.raw = vi.fn();
  git.env = vi.fn(() => git);
  git.branchLocal = vi.fn();
  git.checkIsRepo = vi.fn();
  git.getRemotes = vi.fn();
  return git;
});

/** Captures the options every `simpleGit(...)` instance was built with. */
const simpleGitMock = vi.hoisted(() => vi.fn(() => gitMock));

vi.mock("simple-git", () => ({
  default: simpleGitMock,
  CheckRepoActions: { IS_REPO_ROOT: "root" },
}));

import { CloneError, cloneRepository, type CloneErrorCode } from "@/lib/git/clone";

const PAT = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const CLONE_URL = "https://github.com/octocat/hello-world.git";
const AUTH_PREFIX = "http.extraHeader=Authorization: Basic ";

let root: string;

function dest(name = "octocat-hello-world"): string {
  return path.join(root, name);
}

function rawCalls(): string[][] {
  return gitMock.raw.mock.calls.map((call) => call[0] as string[]);
}

function cloneArgs(index = 0): string[] {
  return rawCalls()[index];
}

/** Staging directories the service has not cleaned up. */
function leftoverStaging(): string[] {
  return fs
    .readdirSync(root)
    .filter((entry) => entry.startsWith(".arij-clone-"));
}

/** Stands in for git: creates the directory it was told to clone into. */
function fakeClone(args: string[]): Promise<string> {
  if (args.includes("clone")) {
    fs.mkdirSync(args[args.length - 1], { recursive: true });
  }
  return Promise.resolve("");
}

/** Stands in for a git run that writes a partial tree and then fails. */
function fakeFailedClone(stderr: string) {
  return (args: string[]) => {
    if (args.includes("clone")) {
      fs.mkdirSync(args[args.length - 1], { recursive: true });
      fs.writeFileSync(path.join(args[args.length - 1], "partial"), "x", "utf-8");
    }
    return Promise.reject(new Error(stderr));
  };
}

/** Turns `-c http.extraHeader=Authorization: Basic <b64>` back into its secret. */
function decodedCredentials(args: string[]): string | null {
  const header = args.find((arg) => arg.startsWith(AUTH_PREFIX));
  if (!header) return null;
  return Buffer.from(header.slice(AUTH_PREFIX.length), "base64").toString("utf-8");
}

/** Makes `dest` look like an existing clone of `originUrl`. */
function existingCloneAt(remotes: Array<{ name: string; url: string }>): void {
  fs.mkdirSync(dest(), { recursive: true });
  gitMock.checkIsRepo.mockResolvedValue(true);
  gitMock.getRemotes.mockResolvedValue(
    remotes.map((remote) => ({
      name: remote.name,
      refs: { fetch: remote.url, push: remote.url },
    }))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  gitMock.raw.mockImplementation(fakeClone);
  gitMock.env.mockImplementation(() => gitMock);
  gitMock.branchLocal.mockResolvedValue({ current: "main", all: ["main"] });
  gitMock.checkIsRepo.mockResolvedValue(false);
  gitMock.getRemotes.mockResolvedValue([]);
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arij-clone-cmd-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("clone command", () => {
  it("clones with full history and no credentials for a public repo", async () => {
    await cloneRepository({ cloneUrl: CLONE_URL, dest: dest() });

    const args = cloneArgs();
    expect(args.slice(0, 3)).toEqual(["clone", "--", CLONE_URL]);
    expect(args.join(" ")).not.toContain("--depth");
    expect(args.join(" ")).not.toContain("--single-branch");
    expect(args.join(" ")).not.toContain("extraHeader");
  });

  it("does not send a configured PAT to a repository that clones anonymously", async () => {
    // A public clone must carry no credentials — and an expired PAT must not
    // be able to break a clone that never needed one.
    await cloneRepository({ cloneUrl: CLONE_URL, dest: dest(), token: PAT });

    expect(rawCalls()).toHaveLength(1);
    expect(JSON.stringify(rawCalls())).not.toContain("extraHeader");
    expect(JSON.stringify(rawCalls())).not.toContain(PAT);
  });

  it("replays the PAT as an http.extraHeader only after an anonymous refusal", async () => {
    gitMock.raw
      .mockImplementationOnce(fakeFailedClone("remote: Repository not found."))
      .mockImplementation(fakeClone);

    const result = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      token: PAT,
    });

    expect(rawCalls()).toHaveLength(2);
    expect(decodedCredentials(cloneArgs(0))).toBeNull();

    const retry = cloneArgs(1);
    expect(retry[0]).toBe("-c");
    expect(retry[1]).toMatch(/^http\.extraHeader=Authorization: Basic /);
    expect(decodedCredentials(retry)).toBe(`x-access-token:${PAT}`);
    // Config for THIS command only — never `git config`, never the remote URL.
    expect(retry).toContain("clone");
    expect(retry).toContain(CLONE_URL);
    expect(retry.join(" ")).not.toContain(`${PAT}@`);

    expect(result.path).toBe(dest());
    // The refused attempt's partial tree is gone before the retry starts.
    expect(leftoverStaging()).toEqual([]);
  });

  it("does not replay the PAT when the failure is not about credentials", async () => {
    gitMock.raw.mockImplementation(
      fakeFailedClone(
        "fatal: unable to access 'https://github.com/octocat/hello-world.git/': Could not resolve host: github.com"
      )
    );

    const error = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      token: PAT,
    }).catch((e) => e);

    expect(error.code).toBe("network");
    expect(rawCalls()).toHaveLength(1);
  });

  it("checks out an explicit branch", async () => {
    gitMock.branchLocal.mockResolvedValue({ current: "develop", all: ["develop"] });

    const result = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      branch: "develop",
    });

    expect(cloneArgs().slice(0, 5)).toEqual([
      "clone",
      "--branch",
      "develop",
      "--",
      CLONE_URL,
    ]);
    expect(result.defaultBranch).toBe("develop");
  });

  it("disables interactive credential prompts", async () => {
    await cloneRepository({ cloneUrl: CLONE_URL, dest: dest() });

    expect(gitMock.env).toHaveBeenCalledWith(
      expect.objectContaining({ GIT_TERMINAL_PROMPT: "0" })
    );
  });

  it("runs git under an abort signal so the timeout can cut it off", async () => {
    await cloneRepository({ cloneUrl: CLONE_URL, dest: dest() });

    expect(simpleGitMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: root, abort: expect.any(AbortSignal) })
    );
  });
});

describe("clone staging", () => {
  it("assembles the clone outside the destination and moves it into place", async () => {
    await cloneRepository({ cloneUrl: CLONE_URL, dest: dest() });

    // git never wrote to the destination directly...
    const target = cloneArgs()[cloneArgs().length - 1];
    expect(target).not.toBe(dest());
    expect(path.dirname(target)).toBe(root);
    expect(path.basename(target)).toMatch(/^\.arij-clone-/);
    // ...it was renamed there at the end, leaving nothing behind.
    expect(fs.existsSync(dest())).toBe(true);
    expect(leftoverStaging()).toEqual([]);
  });

  it("leaves a destination that appeared mid-clone untouched", async () => {
    // The lock is process-local: another process can create the destination
    // while git is running. Inferring ownership from an earlier existence
    // check would delete that directory on the way out.
    gitMock.raw.mockImplementation((args: string[]) => {
      fs.mkdirSync(dest(), { recursive: true });
      fs.writeFileSync(path.join(dest(), "someone-elses.txt"), "keep", "utf-8");
      return fakeClone(args);
    });

    const error = await cloneRepository({ cloneUrl: CLONE_URL, dest: dest() }).catch(
      (e) => e
    );

    expect(error).toBeInstanceOf(CloneError);
    expect(error.code).toBe("conflict");
    expect(fs.readFileSync(path.join(dest(), "someone-elses.txt"), "utf-8")).toBe(
      "keep"
    );
    expect(leftoverStaging()).toEqual([]);
  });

  it("removes the staging directory when the clone fails", async () => {
    gitMock.raw.mockImplementation(fakeFailedClone("remote: Repository not found."));

    await cloneRepository({ cloneUrl: CLONE_URL, dest: dest() }).catch(() => {});

    expect(fs.existsSync(dest())).toBe(false);
    expect(leftoverStaging()).toEqual([]);
  });
});

describe("reuse fetch", () => {
  it("fetches origin, non-interactively and under the deadline", async () => {
    existingCloneAt([{ name: "origin", url: CLONE_URL }]);

    const result = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      expectedOwnerRepo: "octocat/hello-world",
    });

    expect(result.reused).toBe(true);
    expect(rawCalls()).toEqual([["fetch", "origin"]]);
    expect(gitMock.env).toHaveBeenCalledWith(
      expect.objectContaining({ GIT_TERMINAL_PROMPT: "0" })
    );
    expect(simpleGitMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: dest(), abort: expect.any(AbortSignal) })
    );
  });

  it("replays the PAT when the anonymous fetch is refused", async () => {
    // A private repository Arij cloned has no credentials of its own on disk:
    // without the stored PAT its re-import would fail.
    existingCloneAt([{ name: "origin", url: CLONE_URL }]);
    gitMock.raw
      .mockRejectedValueOnce(new Error("remote: Repository not found."))
      .mockResolvedValue("");

    const result = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      expectedOwnerRepo: "octocat/hello-world",
      token: PAT,
    });

    expect(result.reused).toBe(true);
    expect(rawCalls()).toHaveLength(2);
    expect(decodedCredentials(rawCalls()[0])).toBeNull();
    expect(decodedCredentials(rawCalls()[1])).toBe(`x-access-token:${PAT}`);
    expect(rawCalls()[1].slice(2)).toEqual(["fetch", "origin"]);
  });

  it("reuses an ssh clone of the same GitHub repository", async () => {
    // Identity is owner/repo: a hand-made `git@github.com:` clone and an
    // `https://` import URL are the same repository.
    existingCloneAt([
      { name: "origin", url: "git@github.com:octocat/hello-world.git" },
    ]);

    const result = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      expectedOwnerRepo: "octocat/hello-world",
    });

    expect(result.reused).toBe(true);
  });

  it("refuses a destination whose origin points elsewhere, matching remote or not", async () => {
    // `origin` is what the reuse path goes on to fetch, so a secondary remote
    // that happens to match must not authorize reuse of a different checkout.
    existingCloneAt([
      { name: "origin", url: "https://github.com/someone-else/other.git" },
      { name: "github", url: CLONE_URL },
    ]);

    const error = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      expectedOwnerRepo: "octocat/hello-world",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(CloneError);
    expect(error.code).toBe("conflict");
    expect(error.message).toContain("someone-else/other");
    expect(rawCalls()).toEqual([]);
  });

  it("refuses a repository that has no origin at all", async () => {
    existingCloneAt([{ name: "upstream", url: CLONE_URL }]);

    const error = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      expectedOwnerRepo: "octocat/hello-world",
    }).catch((e) => e);

    expect(error.code).toBe("conflict");
    expect(error.message).toContain("origin");
    expect(rawCalls()).toEqual([]);
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
    gitMock.raw.mockImplementation(fakeFailedClone(stderr));

    const error = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      branch: code === "branch_not_found" ? "nope" : null,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(CloneError);
    expect(error.code).toBe(code);
  });

  it("tells the user to add a PAT when none was configured", async () => {
    gitMock.raw.mockImplementation(
      fakeFailedClone("remote: Repository not found.\nfatal: repository not found")
    );

    const error = await cloneRepository({ cloneUrl: CLONE_URL, dest: dest() }).catch(
      (e) => e
    );

    expect(error.message).toContain("Settings → GitHub PAT");
  });

  it("blames the configured PAT once the authenticated retry has failed too", async () => {
    gitMock.raw.mockImplementation(
      fakeFailedClone("remote: Repository not found.\nfatal: repository not found")
    );

    const error = await cloneRepository({
      cloneUrl: CLONE_URL,
      dest: dest(),
      token: PAT,
    }).catch((e) => e);

    expect(rawCalls()).toHaveLength(2);
    expect(error.message).toContain("does not grant access");
    expect(error.message).not.toContain(PAT);
  });

  it("keeps the PAT out of the error, whatever git printed", async () => {
    const basic = Buffer.from(`x-access-token:${PAT}`).toString("base64");
    gitMock.raw.mockImplementation(
      fakeFailedClone(
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
