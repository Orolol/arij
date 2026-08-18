/**
 * The app-managed clone root: lib/projects/workspace-constants.ts (client-safe
 * key/default/parser) and lib/projects/workspace.ts (settings resolution,
 * mkdir, destination building and the escape guard).
 *
 * Backed by `createTestDb()` rather than a query-chain mock: the settings read
 * is the whole point of `resolveProjectsRoot()`, and only a real database with
 * the real migration chain proves it reads the right key with the right
 * decoding. Nothing here touches the developer's `data/arij.db`, the network,
 * or any directory outside the OS temp dir.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { settings } from "@/lib/db/schema";
import {
  DEFAULT_PROJECTS_DIRNAME,
  PROJECTS_ROOT_SETTING_KEY,
  parseProjectsRoot,
} from "@/lib/projects/workspace-constants";

// One in-memory database, built from the real migrations, standing in for the
// app's singleton. `resolveProjectsRoot()` reads `db` at call time, so rows
// written below are visible to it immediately.
vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  return { db: createTestDb().db };
});

import { db } from "@/lib/db";

/**
 * Writes the `projects_root` settings row exactly as the PATCH route does —
 * JSON-encoded — so the resolver is exercised against the real stored shape.
 * `undefined` clears the row, i.e. "no override configured".
 */
function storeRoot(value: string | undefined): void {
  db.delete(settings).where(eq(settings.key, PROJECTS_ROOT_SETTING_KEY)).run();
  if (value === undefined) return;

  db.insert(settings)
    .values({ key: PROJECTS_ROOT_SETTING_KEY, value: JSON.stringify(value) })
    .run();
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arij-workspace-test-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  vi.clearAllMocks();
  storeRoot(undefined);
});

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("workspace-constants", () => {
  it("exports the settings key and the default directory name", () => {
    expect(PROJECTS_ROOT_SETTING_KEY).toBe("projects_root");
    expect(DEFAULT_PROJECTS_DIRNAME).toBe("projects");
  });

  it("imports nothing from the database layer (client-safe)", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib", "projects", "workspace-constants.ts"),
      "utf-8"
    );
    expect(source).not.toContain("@/lib/db");
    expect(source).not.toMatch(/from\s+"node:/);
  });

  it("decodes the JSON-encoded value stored by the settings route", () => {
    expect(parseProjectsRoot(JSON.stringify("/srv/code"))).toBe("/srv/code");
  });

  it("accepts an already-decoded value (the shape the GET route returns)", () => {
    expect(parseProjectsRoot("/srv/code")).toBe("/srv/code");
  });

  it("keeps a path that happens to be valid JSON as a literal directory name", () => {
    expect(parseProjectsRoot("123")).toBe("123");
  });

  it("treats blank and non-string values as no override", () => {
    expect(parseProjectsRoot("")).toBeNull();
    expect(parseProjectsRoot('""')).toBeNull();
    expect(parseProjectsRoot("   ")).toBeNull();
    expect(parseProjectsRoot(null)).toBeNull();
    expect(parseProjectsRoot(undefined)).toBeNull();
    expect(parseProjectsRoot({ root: "/srv" })).toBeNull();
    expect(parseProjectsRoot(42)).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(parseProjectsRoot("  /srv/code  ")).toBe("/srv/code");
  });
});

describe("resolveProjectsRoot", () => {
  it("falls back to <cwd>/projects when nothing is stored", async () => {
    storeRoot(undefined);
    const { resolveProjectsRoot } = await import("@/lib/projects/workspace");

    expect(resolveProjectsRoot()).toBe(path.join(process.cwd(), "projects"));
  });

  it("falls back to <cwd>/projects when the stored override is blank", async () => {
    storeRoot("   ");
    const { resolveProjectsRoot } = await import("@/lib/projects/workspace");

    expect(resolveProjectsRoot()).toBe(path.join(process.cwd(), "projects"));
  });

  it("returns the configured absolute override", async () => {
    storeRoot("/srv/arij-clones");
    const { resolveProjectsRoot } = await import("@/lib/projects/workspace");

    expect(resolveProjectsRoot()).toBe("/srv/arij-clones");
  });

  it("resolves a relative override against process.cwd()", async () => {
    storeRoot("../shared-clones");
    const { resolveProjectsRoot } = await import("@/lib/projects/workspace");

    const resolved = resolveProjectsRoot();
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(path.resolve(process.cwd(), "../shared-clones"));
  });

  it("defaultProjectsRoot() does not read settings at all", async () => {
    const { defaultProjectsRoot } = await import("@/lib/projects/workspace");

    expect(defaultProjectsRoot()).toBe(path.join(process.cwd(), "projects"));
  });
});

describe("ensureProjectsRoot", () => {
  it("creates the root recursively", async () => {
    const root = path.join(tempDir(), "nested", "clones");
    storeRoot(root);
    const { ensureProjectsRoot } = await import("@/lib/projects/workspace");

    expect(ensureProjectsRoot()).toBe(root);
    expect(fs.statSync(root).isDirectory()).toBe(true);
  });

  it("is a no-op when the root already exists", async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, "marker"), "keep me");
    storeRoot(root);
    const { ensureProjectsRoot } = await import("@/lib/projects/workspace");

    // Two calls, and nothing already inside is disturbed.
    expect(ensureProjectsRoot()).toBe(root);
    expect(ensureProjectsRoot()).toBe(root);
    expect(fs.readFileSync(path.join(root, "marker"), "utf-8")).toBe("keep me");
  });
});

describe("cloneDestinationFor", () => {
  it("builds <root>/<owner>-<repo>", async () => {
    storeRoot("/srv/clones");
    const { cloneDestinationFor } = await import("@/lib/projects/workspace");

    expect(cloneDestinationFor("Orolol", "arij")).toBe("/srv/clones/Orolol-arij");
  });

  it("uses the default root when no override is configured", async () => {
    storeRoot(undefined);
    const { cloneDestinationFor } = await import("@/lib/projects/workspace");

    expect(cloneDestinationFor("Orolol", "arij")).toBe(
      path.join(process.cwd(), "projects", "Orolol-arij")
    );
  });

  it("is deterministic across owners of the same repo name", async () => {
    storeRoot("/srv/clones");
    const { cloneDestinationFor } = await import("@/lib/projects/workspace");

    expect(cloneDestinationFor("alice", "app")).not.toBe(
      cloneDestinationFor("bob", "app")
    );
  });

  it("rejects traversal components in owner or repo", async () => {
    storeRoot("/srv/clones");
    const { cloneDestinationFor } = await import("@/lib/projects/workspace");

    for (const [owner, repo] of [
      ["..", "arij"],
      ["Orolol", ".."],
      [".", "arij"],
      ["../../etc", "arij"],
      ["Orolol", "../../../tmp/evil"],
      ["own er", "arij"],
      ["", "arij"],
      ["Orolol", ""],
      ["Orolol/nested", "arij"],
    ] as const) {
      expect(() => cloneDestinationFor(owner, repo)).toThrow(/Invalid GitHub/);
    }
  });
});

describe("assertInsideRoot", () => {
  it("returns the resolved destination for a path inside the root", async () => {
    const { assertInsideRoot } = await import("@/lib/projects/workspace");

    expect(assertInsideRoot("/srv/clones/owner-repo", "/srv/clones")).toBe(
      "/srv/clones/owner-repo"
    );
  });

  it("throws for a destination that resolves outside the root", async () => {
    const { assertInsideRoot } = await import("@/lib/projects/workspace");

    for (const escape of [
      "/srv/clones/../evil",
      "/etc/passwd",
      "../outside",
      "/srv/clones-sibling", // prefix match without a separator
    ]) {
      expect(() => assertInsideRoot(escape, "/srv/clones")).toThrow(
        /outside the projects root/
      );
    }
  });

  it("throws for the root itself (a clone there would nest every later clone)", async () => {
    const { assertInsideRoot } = await import("@/lib/projects/workspace");

    expect(() => assertInsideRoot("/srv/clones", "/srv/clones")).toThrow(
      /outside the projects root/
    );
  });

  it("defaults the root to the configured one", async () => {
    storeRoot("/srv/clones");
    const { assertInsideRoot } = await import("@/lib/projects/workspace");

    expect(assertInsideRoot("/srv/clones/owner-repo")).toBe(
      "/srv/clones/owner-repo"
    );
  });

  it("keeps the underlying containment failure as the error cause", async () => {
    // The check itself lives in the db-free workspace-path module; losing the
    // cause would make a production failure unattributable.
    const { assertInsideRoot } = await import("@/lib/projects/workspace");
    const { WorkspacePathError } = await import(
      "@/lib/projects/workspace-path"
    );

    try {
      assertInsideRoot("/etc/passwd", "/srv/clones");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).cause).toBeInstanceOf(WorkspacePathError);
    }
  });
});

/**
 * Behaviour the query-chain mock structurally cannot check: it returns the
 * queued row whatever the query asked for, so a resolver reading the wrong
 * settings key would still pass. Against a real database, it cannot.
 */
describe("resolveProjectsRoot — against a real settings table", () => {
  it("reads the projects_root key and no other", async () => {
    db.delete(settings).run();
    db.insert(settings)
      .values([
        { key: "github_pat", value: JSON.stringify("ghp_not_a_path") },
        { key: "projects_root", value: JSON.stringify("/srv/the-right-one") },
        { key: "clone_timeout_ms", value: JSON.stringify(60000) },
      ])
      .run();

    const { resolveProjectsRoot } = await import("@/lib/projects/workspace");

    expect(resolveProjectsRoot()).toBe("/srv/the-right-one");
  });

  it("ignores an unrelated key that merely looks similar", async () => {
    db.delete(settings).run();
    db.insert(settings)
      .values({ key: "projects_root_backup", value: JSON.stringify("/srv/nope") })
      .run();

    const { resolveProjectsRoot } = await import("@/lib/projects/workspace");

    expect(resolveProjectsRoot()).toBe(path.join(process.cwd(), "projects"));
  });

  it("survives a row written raw rather than JSON-encoded", async () => {
    // Hand-edited databases and older writers both produce this shape.
    db.delete(settings).run();
    db.insert(settings)
      .values({ key: PROJECTS_ROOT_SETTING_KEY, value: "/srv/raw-value" })
      .run();

    const { resolveProjectsRoot } = await import("@/lib/projects/workspace");

    expect(resolveProjectsRoot()).toBe("/srv/raw-value");
  });

  it("picks up a change written after the module was first imported", async () => {
    const { resolveProjectsRoot } = await import("@/lib/projects/workspace");

    storeRoot("/srv/first");
    expect(resolveProjectsRoot()).toBe("/srv/first");

    // No caching: the Settings page must take effect on the next clone.
    storeRoot("/srv/second");
    expect(resolveProjectsRoot()).toBe("/srv/second");
  });

  it("puts worktrees beside the clone, inside the same root", async () => {
    // createWorktree() uses path.join(repoPath, "..", ".arij-worktrees"), so
    // this is the property that keeps a single /projects gitignore rule enough.
    storeRoot("/srv/clones");
    const { cloneDestinationFor } = await import("@/lib/projects/workspace");

    const dest = cloneDestinationFor("Orolol", "arij");
    expect(path.join(dest, "..", ".arij-worktrees")).toBe(
      "/srv/clones/.arij-worktrees"
    );
  });
});
