import { isAbsolute, relative, resolve } from "node:path";

/**
 * Pure path helpers for the app-managed clone root. Deliberately free of any
 * `db` or settings import so it stays safe to use from anywhere, including the
 * parsing layer that runs before a root has been resolved.
 */

export class WorkspacePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

/**
 * Resolves `candidate` against `root` and guarantees the result is a strict
 * descendant of it. Defence in depth behind `parseGitHubRepoInput()`: even if a
 * traversal component reached this far, it cannot produce a path outside the
 * clone root.
 *
 * @returns the resolved absolute path
 * @throws WorkspacePathError when the candidate escapes, or equals, the root
 */
export function assertInsideRoot(root: string, candidate: string): string {
  if (!root || !root.trim()) {
    throw new WorkspacePathError("Clone root is required.");
  }
  if (!candidate || !candidate.trim()) {
    throw new WorkspacePathError("Clone destination is required.");
  }
  if (root.includes("\0") || candidate.includes("\0")) {
    throw new WorkspacePathError("Path contains invalid characters.");
  }

  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(resolvedRoot, candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);

  if (rel === "" || /^\.\.($|[\\/])/.test(rel) || isAbsolute(rel)) {
    throw new WorkspacePathError(
      `Resolved path escapes the clone root: ${resolvedCandidate}`
    );
  }

  return resolvedCandidate;
}
