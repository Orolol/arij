import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  assertInsideRoot,
  WorkspacePathError,
} from "@/lib/projects/workspace-path";

const ROOT = "/tmp/arij/projects";

describe("assertInsideRoot", () => {
  it("resolves a plain child directory", () => {
    expect(assertInsideRoot(ROOT, "octocat-hello-world")).toBe(
      join(ROOT, "octocat-hello-world")
    );
  });

  it("accepts an absolute candidate that is already inside the root", () => {
    const inside = join(ROOT, "octocat-hello-world");
    expect(assertInsideRoot(ROOT, inside)).toBe(inside);
  });

  it("normalises a relative root", () => {
    const resolved = assertInsideRoot("projects", "octocat-hello-world");
    expect(resolved.endsWith(join("projects", "octocat-hello-world"))).toBe(true);
  });

  // Defence in depth: parseGitHubRepoInput() rejects these first, but the
  // path layer must catch them independently.
  it.each([
    ["parent traversal", ".."],
    ["nested traversal", "../escape"],
    ["deep traversal", "../../../etc/passwd"],
    ["traversal through a valid-looking segment", "octocat-repo/../../escape"],
    ["absolute path outside the root", "/etc/passwd"],
    ["sibling directory by prefix", "../projects-evil"],
  ])("throws on %s", (_label, candidate) => {
    expect(() => assertInsideRoot(ROOT, candidate)).toThrow(WorkspacePathError);
  });

  it("throws when the candidate resolves to the root itself", () => {
    expect(() => assertInsideRoot(ROOT, ".")).toThrow(WorkspacePathError);
    expect(() => assertInsideRoot(ROOT, ROOT)).toThrow(WorkspacePathError);
  });

  it("throws on a NUL byte", () => {
    expect(() => assertInsideRoot(ROOT, "octocat\0evil")).toThrow(
      WorkspacePathError
    );
  });

  it("throws on empty root or candidate", () => {
    expect(() => assertInsideRoot("", "repo")).toThrow(WorkspacePathError);
    expect(() => assertInsideRoot(ROOT, "")).toThrow(WorkspacePathError);
    expect(() => assertInsideRoot(ROOT, "   ")).toThrow(WorkspacePathError);
  });

  it("does not leak the escaping path as a silent success", () => {
    expect(() => assertInsideRoot(ROOT, "../..")).toThrow(
      /escapes the clone root/
    );
  });
});
