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

/** Makes `origin` resolve to the given URL, and HEAD look checked out. */
function existingCloneOf(remoteUrl: string, options: { head?: boolean } = {}) {
  const { head = true } = options;
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, "README.md"), "x");
  getRemotes.mockResolvedValue([
    { name: "origin", refs: { fetch: remoteUrl, push: remoteUrl } },
  ]);
  gitRaw.mockImplementation(async (args: string[]) => {
    if (args.includes("--verify") && !head) throw new Error("unborn HEAD");
    if (args.includes("--abbrev-ref")) return "main\n";
    return "";
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arij-clone-flow-"));
  destination = path.join(tmpRoot, "projects", "owner-repo");
  getRemotes.mockResolvedValue([]);
  gitRaw.mockImplementation(async (args: string[]) => {
    if (args.includes("--abbrev-ref")) return "main\n";
    return "";
  });
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

  it("replaces debris left by an interrupted clone instead of reporting a conflict", async () => {
    // Right origin, but nothing checked out: a clone killed mid-transfer.
    existingCloneOf("https://github.com/owner/repo.git", { head: false });

    const result = await cloneGitHubRepository({
      input: "owner/repo",
      destination,
    });

    expect(result.destinationState).toBe("partial_clone");
    expect(result.reused).toBe(false);
    expect(calledWith("clone")).toHaveLength(1);
    // The debris was cleared before git was asked to clone into it.
    expect(fs.existsSync(path.join(destination, "README.md"))).toBe(false);
  });

  it("replaces a leftover directory that is not a git repository", async () => {
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "half-downloaded"), "x");
    getRemotes.mockRejectedValue(new Error("not a git repository"));

    const result = await cloneGitHubRepository({
      input: "owner/repo",
      destination,
    });

    expect(result.destinationState).toBe("partial_clone");
    expect(calledWith("clone")).toHaveLength(1);
  });

  it("clones into an existing empty directory", async () => {
    fs.mkdirSync(destination, { recursive: true });

    const result = await cloneGitHubRepository({
      input: "owner/repo",
      destination,
    });

    expect(result.destinationState).toBe("empty");
    expect(calledWith("clone")).toHaveLength(1);
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

  it("deletes a partial clone when git fails, so it is not mistaken for a match later", async () => {
    gitRaw.mockImplementation(async (args: string[]) => {
      if (args.includes("clone")) {
        fs.mkdirSync(destination, { recursive: true });
        fs.writeFileSync(path.join(destination, "partial.pack"), "x");
        throw new Error("early EOF");
      }
      return "";
    });

    await expect(
      cloneGitHubRepository({ input: "owner/repo", destination })
    ).rejects.toBeInstanceOf(CloneFailedError);

    expect(fs.existsSync(destination)).toBe(false);
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
