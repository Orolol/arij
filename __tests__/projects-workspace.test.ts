/**
 * The app-managed clone root: lib/projects/workspace-constants.ts (client-safe
 * key/default/parser) and lib/projects/workspace.ts (settings resolution,
 * mkdir, destination building and the escape guard).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";
import {
  DEFAULT_PROJECTS_DIRNAME,
  PROJECTS_ROOT_SETTING_KEY,
  parseProjectsRoot,
} from "@/lib/projects/workspace-constants";

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock ignores
// column identity, so no fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

/**
 * Queues the settings row resolveProjectsRoot() reads. Each resolver call
 * consumes one entry, so the queue is padded for tests that resolve repeatedly.
 */
function storeRoot(value: unknown): void {
  dbMockState.getQueue = Array.from({ length: 32 }, () =>
    value === undefined ? null : { value }
  );
}

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arij-workspace-test-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMockState();
});

afterEach(() => {
  // No restoreAllMocks(): it would strip the shared db chain mock's
  // implementations, and the module factory only runs once per file.
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
    storeRoot(JSON.stringify("   "));
    const { resolveProjectsRoot } = await import("@/lib/projects/workspace");

    expect(resolveProjectsRoot()).toBe(path.join(process.cwd(), "projects"));
  });

  it("returns the configured absolute override", async () => {
    storeRoot(JSON.stringify("/srv/arij-clones"));
    const { resolveProjectsRoot } = await import("@/lib/projects/workspace");

    expect(resolveProjectsRoot()).toBe("/srv/arij-clones");
  });

  it("resolves a relative override against process.cwd()", async () => {
    storeRoot(JSON.stringify("../shared-clones"));
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
    storeRoot(JSON.stringify(root));
    const { ensureProjectsRoot } = await import("@/lib/projects/workspace");

    expect(ensureProjectsRoot()).toBe(root);
    expect(fs.statSync(root).isDirectory()).toBe(true);
  });

  it("is a no-op when the root already exists", async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, "marker"), "keep me");
    storeRoot(JSON.stringify(root));
    const { ensureProjectsRoot } = await import("@/lib/projects/workspace");

    // Two calls, and nothing already inside is disturbed.
    expect(ensureProjectsRoot()).toBe(root);
    expect(ensureProjectsRoot()).toBe(root);
    expect(fs.readFileSync(path.join(root, "marker"), "utf-8")).toBe("keep me");
  });
});

describe("cloneDestinationFor", () => {
  it("builds <root>/<owner>-<repo>", async () => {
    storeRoot(JSON.stringify("/srv/clones"));
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
    storeRoot(JSON.stringify("/srv/clones"));
    const { cloneDestinationFor } = await import("@/lib/projects/workspace");

    expect(cloneDestinationFor("alice", "app")).not.toBe(
      cloneDestinationFor("bob", "app")
    );
  });

  it("rejects traversal components in owner or repo", async () => {
    storeRoot(JSON.stringify("/srv/clones"));
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
    storeRoot(JSON.stringify("/srv/clones"));
    const { assertInsideRoot } = await import("@/lib/projects/workspace");

    expect(assertInsideRoot("/srv/clones/owner-repo")).toBe(
      "/srv/clones/owner-repo"
    );
  });
});
