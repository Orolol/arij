import { stat } from "node:fs/promises";
import { resolve, normalize } from "node:path";

type PathValidationResult =
  | { valid: true; normalizedPath: string }
  | { valid: false; error: string };

export async function validatePath(
  inputPath: string
): Promise<PathValidationResult> {
  if (!inputPath || inputPath.trim().length === 0) {
    return { valid: false, error: "Path is required" };
  }

  if (inputPath.includes("\0")) {
    return { valid: false, error: "Path contains invalid characters" };
  }

  const trimmed = inputPath.trim();

  // Reject traversal before normalization, testing path *components* rather
  // than the raw substring: a `..` inside a name is not traversal, and
  // `repo..archive` is both a legal GitHub repository and therefore a legal
  // clone directory (isSafeRepoSegment() in lib/git/remote-parse.ts draws the
  // line in the same place). A lone `.` is not traversal either — resolve()
  // below collapses it. Backslash counts as a separator so the check does not
  // depend on the host platform.
  const segments = trimmed.split(/[\\/]+/);
  if (segments.some((segment) => segment === "..")) {
    return {
      valid: false,
      error: "Path must not contain traversal components (..)",
    };
  }

  const normalized = resolve(normalize(trimmed));

  try {
    const stats = await stat(normalized);
    if (!stats.isDirectory()) {
      return { valid: false, error: "Path is not a directory" };
    }
  } catch {
    return {
      valid: false,
      error: "Path does not exist or is not accessible",
    };
  }

  return { valid: true, normalizedPath: normalized };
}
