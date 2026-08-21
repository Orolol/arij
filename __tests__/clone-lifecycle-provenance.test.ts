import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Provenance: who is allowed to say that Arij created a directory.
 *
 * `clone_source = "github"` is what later authorises deleting a directory, so
 * the question these tests pin down is not "is the flag stored correctly" but
 * "can a request set it". It must not be settable at creation, at update, or by
 * moving a project's path around afterwards — the only thing that grants it is
 * a marker the clone service wrote into a directory it made itself.
 */

vi.mock("@/lib/db", () => ({ db: {} }));

import {
  deriveCloneProvenance,
  GITHUB_CLONE_SOURCE,
} from "@/lib/projects/clone-provenance";
import { createProjectSchema, updateProjectSchema } from "@/lib/validation/schemas";
import { writeCloneMarker, readCloneMarker } from "@/lib/git/clone-marker";

let tmpRoot: string;
let projectsRoot: string;

/** A directory that looks like a repository, optionally stamped by Arij. */
async function makeDir(
  name: string,
  options: { marked?: boolean; root?: string } = {}
): Promise<string> {
  const root = options.root ?? projectsRoot;
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  if (options.marked) {
    await writeCloneMarker(dir, {
      owner: "owner",
      repo: "repo",
      ownerRepo: "owner/repo",
      remoteUrl: "https://github.com/owner/repo.git",
    });
  }
  return dir;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "arij-provenance-"));
  projectsRoot = path.join(tmpRoot, "projects");
  fs.mkdirSync(projectsRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("deriveCloneProvenance", () => {
  it("claims a marked directory inside the projects root", async () => {
    const dir = await makeDir("owner-repo", { marked: true });

    expect(deriveCloneProvenance(dir, { projectsRoot })).toEqual({
      cloneSource: GITHUB_CLONE_SOURCE,
      gitRemoteUrl: "https://github.com/owner/repo.git",
      githubOwnerRepo: "owner/repo",
    });
  });

  it("refuses an unmarked directory, however well placed", async () => {
    // A checkout the user keeps under the projects root. Location is not
    // ownership.
    const dir = await makeDir("owner-repo", { marked: false });

    expect(deriveCloneProvenance(dir, { projectsRoot }).cloneSource).toBeNull();
  });

  it("refuses a marked directory that has been moved out of the root", async () => {
    // The marker travels with the directory, so it alone would keep deletion
    // rights alive for a clone that is no longer anywhere Arij manages.
    const outside = path.join(tmpRoot, "elsewhere");
    fs.mkdirSync(outside, { recursive: true });
    const dir = await makeDir("owner-repo", { marked: true, root: outside });

    expect(readCloneMarker(dir)).not.toBeNull();
    expect(deriveCloneProvenance(dir, { projectsRoot }).cloneSource).toBeNull();
  });

  it("refuses the projects root itself and paths that climb out of it", async () => {
    expect(
      deriveCloneProvenance(projectsRoot, { projectsRoot }).cloneSource
    ).toBeNull();
    expect(
      deriveCloneProvenance(path.join(projectsRoot, "..", "..", "etc"), {
        projectsRoot,
      }).cloneSource
    ).toBeNull();
  });

  it("refuses an empty or absent path", () => {
    for (const value of [null, undefined, "", "   "]) {
      expect(deriveCloneProvenance(value, { projectsRoot }).cloneSource).toBeNull();
    }
  });

  it("ignores a marker that is malformed or of an unknown version", async () => {
    const dir = await makeDir("owner-repo");
    const marker = path.join(dir, ".git", "arij-clone.json");

    fs.writeFileSync(marker, "{ not json");
    expect(deriveCloneProvenance(dir, { projectsRoot }).cloneSource).toBeNull();

    fs.writeFileSync(marker, JSON.stringify({ version: 99, owner: "o", repo: "r" }));
    expect(deriveCloneProvenance(dir, { projectsRoot }).cloneSource).toBeNull();
  });
});

describe("request schemas", () => {
  it("drops a client-supplied cloneSource on create", () => {
    const parsed = createProjectSchema.parse({
      name: "Demo",
      gitRepoPath: "/anywhere",
      cloneSource: "github",
    });

    expect(parsed).not.toHaveProperty("cloneSource");
  });

  it("drops cloneSource and gitRemoteUrl on update", () => {
    const parsed = updateProjectSchema.parse({
      name: "Demo",
      cloneSource: "github",
      gitRemoteUrl: "https://github.com/attacker/repo.git",
    });

    expect(parsed).not.toHaveProperty("cloneSource");
    expect(parsed).not.toHaveProperty("gitRemoteUrl");
  });
});
