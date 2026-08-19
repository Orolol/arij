/**
 * `POST /api/projects` — the last step of every import, and until now the only
 * project route with no coverage at all.
 *
 * Runs against `createTestDb()` (real migration chain, real columns) rather
 * than a query-chain mock: the point of most of these assertions is that a
 * value survives into the column migration 0027 added, which a mock that
 * records `.values()` calls cannot show. Paths are real temp directories —
 * `validatePath()` stats them — and nothing here touches the network.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { projects, settings } from "@/lib/db/schema";
import { PROJECTS_ROOT_SETTING_KEY } from "@/lib/projects/workspace-constants";
import { mockJsonRequest, mockNextRequest } from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  return { db: createTestDb().db };
});

import { db } from "@/lib/db";
import { POST } from "@/app/api/projects/route";

const tempDirs: string[] = [];

function repoDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arij-project-post-"));
  tempDirs.push(dir);
  return dir;
}

function post(body: unknown) {
  return POST(
    mockJsonRequest(body, { url: "http://localhost:3000/api/projects" })
  );
}

/** The row as SQLite actually holds it, not as the route echoed it back. */
function storedProject(id: string) {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

/**
 * Reproduces what the clone service leaves on disk: a managed clone root, with
 * `<owner>-<repo>` inside it. `cloneSource: "github"` is only accepted for
 * exactly this path, so tests that claim it have to earn it.
 */
function managedClone(owner: string, repo: string): { root: string; dir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "arij-projects-root-"));
  tempDirs.push(root);

  db.insert(settings)
    .values({ key: PROJECTS_ROOT_SETTING_KEY, value: JSON.stringify(root) })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: JSON.stringify(root) },
    })
    .run();

  const dir = path.join(root, `${owner}-${repo}`);
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir };
}

beforeEach(() => {
  db.delete(projects).run();
  db.delete(settings).run();
});

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("POST /api/projects — creation", () => {
  it("creates a project and returns it with 201", async () => {
    const response = await post({ name: "Arij", description: "orchestrator" });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toMatchObject({
      name: "Arij",
      description: "orchestrator",
      status: "ideation",
    });
    expect(body.data.id).toBeTruthy();
    expect(storedProject(body.data.id)?.name).toBe("Arij");
  });

  it("defaults every optional field to NULL", async () => {
    const body = await (await post({ name: "Minimal" })).json();
    const row = storedProject(body.data.id);

    expect(row).toMatchObject({
      description: null,
      gitRepoPath: null,
      githubOwnerRepo: null,
      cloneSource: null,
      gitRemoteUrl: null,
      defaultBranch: null,
    });
  });

  it("rejects a missing name with 400 and writes nothing", async () => {
    const response = await post({ description: "no name" });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Validation failed");
    expect(db.select().from(projects).all()).toHaveLength(0);
  });

  it("rejects a malformed JSON body with 400", async () => {
    const response = await POST(
      mockNextRequest({
        method: "POST",
        url: "http://localhost:3000/api/projects",
        body: "{not json",
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Invalid JSON body");
  });
});

describe("POST /api/projects — clone metadata", () => {
  it("persists githubOwnerRepo so push/PR/release work with no Connect step", async () => {
    const body = await (
      await post({ name: "Arij", githubOwnerRepo: "Orolol/arij" })
    ).json();

    expect(body.data.githubOwnerRepo).toBe("Orolol/arij");
    expect(storedProject(body.data.id)?.githubOwnerRepo).toBe("Orolol/arij");
  });

  it("persists the full clone provenance an import writes", async () => {
    const { dir } = managedClone("Orolol", "arij");

    const body = await (
      await post({
        name: "arij",
        gitRepoPath: dir,
        githubOwnerRepo: "Orolol/arij",
        cloneSource: "github",
        gitRemoteUrl: "https://github.com/Orolol/arij.git",
        defaultBranch: "main",
      })
    ).json();

    expect(storedProject(body.data.id)).toMatchObject({
      gitRepoPath: dir,
      githubOwnerRepo: "Orolol/arij",
      cloneSource: "github",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      defaultBranch: "main",
    });
  });

  it("leaves cloneSource NULL for a user-supplied path", async () => {
    // The ownership flag: a directory Arij did not create must never be
    // offered for deletion when the project is deleted.
    const body = await (
      await post({ name: "Local repo", gitRepoPath: repoDir() })
    ).json();

    expect(storedProject(body.data.id)?.cloneSource).toBeNull();
  });

  it("rejects a cloneSource Arij does not issue", async () => {
    const response = await post({ name: "Spoofed", cloneSource: "gitlab" });

    expect(response.status).toBe(400);
    expect(db.select().from(projects).all()).toHaveLength(0);
  });

  it("accepts an explicit null for each optional clone field", async () => {
    const response = await post({
      name: "Nulls",
      cloneSource: null,
      gitRemoteUrl: null,
      defaultBranch: null,
      githubOwnerRepo: null,
    });

    expect(response.status).toBe(201);
  });

  it("rejects an over-length remote url", async () => {
    const response = await post({
      name: "Long",
      gitRemoteUrl: `https://github.com/o/${"a".repeat(500)}.git`,
    });

    expect(response.status).toBe(400);
  });
});

describe("POST /api/projects — path normalisation", () => {
  it("stores the resolved path, not the string the caller typed", async () => {
    const dir = repoDir();

    for (const input of [`${dir}/`, `${dir}//`, `${dir}/.`, ` ${dir} `]) {
      db.delete(projects).run();
      const body = await (await post({ name: "Normalised", gitRepoPath: input })).json();

      expect(body.data.gitRepoPath).toBe(dir);
      expect(storedProject(body.data.id)?.gitRepoPath).toBe(dir);
    }
  });

  it("stores a path that worktrees can be hung off unchanged", async () => {
    // createWorktree() joins `<gitRepoPath>/../.arij-worktrees`; a stored
    // trailing slash would push that one directory too deep.
    const dir = repoDir();
    const body = await (
      await post({ name: "Worktree host", gitRepoPath: `${dir}/` })
    ).json();

    const stored = storedProject(body.data.id)!.gitRepoPath!;
    expect(path.join(stored, "..", ".arij-worktrees")).toBe(
      path.join(path.dirname(dir), ".arij-worktrees")
    );
  });

  it("rejects a path that does not exist", async () => {
    const response = await post({
      name: "Ghost",
      gitRepoPath: path.join(os.tmpdir(), "arij-does-not-exist-4c1f"),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/does not exist/i);
    expect(db.select().from(projects).all()).toHaveLength(0);
  });

  it("rejects a path pointing at a file rather than a directory", async () => {
    const file = path.join(repoDir(), "README.md");
    fs.writeFileSync(file, "# not a repo");

    const response = await post({ name: "File", gitRepoPath: file });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/not a directory/i);
  });

  it.each([
    ["traversal", "/tmp/../etc"],
    ["embedded traversal", "/tmp/foo/../../etc"],
    ["NUL byte", "/tmp/evil\0/repo"],
  ])("rejects a %s path with 400", async (_label, gitRepoPath) => {
    const response = await post({ name: "Escape", gitRepoPath });

    expect(response.status).toBe(400);
    expect(db.select().from(projects).all()).toHaveLength(0);
  });

  it("treats an empty path as no path at all", async () => {
    const response = await post({ name: "Blank", gitRepoPath: "" });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(storedProject(body.data.id)?.gitRepoPath).toBeNull();
  });
});

/**
 * `cloneSource` is an ownership claim: it is what later authorises Arij to
 * delete the directory, so it cannot be something a request simply asserts.
 * `gitRemoteUrl` is bound by the no-secret-on-disk contract in the same way.
 */
describe("POST /api/projects — clone provenance is server-verified", () => {
  it("refuses to mark a directory Arij never cloned as a github clone", async () => {
    managedClone("Orolol", "arij");
    // A real directory, but not the managed destination for this repository.
    const outsider = repoDir();

    const response = await post({
      name: "Spoofed",
      gitRepoPath: outsider,
      githubOwnerRepo: "Orolol/arij",
      cloneSource: "github",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/cloned itself/i);
    expect(db.select().from(projects).all()).toHaveLength(0);
  });

  it("refuses a managed path claimed for the wrong repository", async () => {
    const { dir } = managedClone("Orolol", "arij");

    const response = await post({
      name: "Mismatched",
      gitRepoPath: dir,
      githubOwnerRepo: "attacker/evil",
      cloneSource: "github",
      gitRemoteUrl: "https://github.com/attacker/evil.git",
    });

    expect(response.status).toBe(400);
    expect(db.select().from(projects).all()).toHaveLength(0);
  });

  it("refuses github provenance with no path at all", async () => {
    const response = await post({
      name: "Pathless",
      cloneSource: "github",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
    });

    expect(response.status).toBe(400);
    expect(db.select().from(projects).all()).toHaveLength(0);
  });

  it.each([
    ["https://x-access-token:ghp_secret@github.com/Orolol/arij.git"],
    ["https://user:password@github.com/Orolol/arij.git"],
  ])("refuses to store a credential-bearing remote url (%s)", async (url) => {
    const response = await post({ name: "Tokenised", gitRemoteUrl: url });

    expect(response.status).toBe(400);
    // The point is not just the rejection: nothing carrying the secret is
    // written, so it cannot leak later through a diff or a log surface.
    expect(db.select().from(projects).all()).toHaveLength(0);
    expect((await response.json()).error).not.toContain("ghp_secret");
  });

  it("refuses a remote url that is not a GitHub repository", async () => {
    const response = await post({
      name: "Elsewhere",
      gitRemoteUrl: "https://gitlab.com/Orolol/arij.git",
    });

    expect(response.status).toBe(400);
  });

  it("refuses a remote url that contradicts githubOwnerRepo", async () => {
    const response = await post({
      name: "Contradictory",
      githubOwnerRepo: "Orolol/arij",
      gitRemoteUrl: "https://github.com/someone/else.git",
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/does not match/i);
  });

  it("normalises the stored remote url instead of echoing the input", async () => {
    const body = await (
      await post({
        name: "Browser URL",
        // What a user actually pastes out of the address bar.
        gitRemoteUrl: "https://github.com/Orolol/arij/tree/main",
      })
    ).json();

    expect(storedProject(body.data.id)).toMatchObject({
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      // Derived rather than demanded: the remote already names the repo.
      githubOwnerRepo: "Orolol/arij",
    });
  });

  it("still accepts a plain local import with no provenance", async () => {
    const response = await post({ name: "Local", gitRepoPath: repoDir() });

    expect(response.status).toBe(201);
    expect(storedProject((await response.json()).data.id)).toMatchObject({
      cloneSource: null,
      gitRemoteUrl: null,
    });
  });

  it.each([
    ["leading dash", "--upload-pack=touch/pwned"],
    ["whitespace", "main branch"],
    ["ref metacharacter", "main^{}"],
  ])("refuses a branch name git would reject (%s)", async (_label, branch) => {
    const response = await post({ name: "Bad branch", defaultBranch: branch });

    expect(response.status).toBe(400);
    expect(db.select().from(projects).all()).toHaveLength(0);
  });

  it("accepts an ordinary slashed branch name", async () => {
    const body = await (
      await post({ name: "Slashed", defaultBranch: "release/v2" })
    ).json();

    expect(storedProject(body.data.id)?.defaultBranch).toBe("release/v2");
  });
});
