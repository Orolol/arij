import simpleGit from "simple-git";

/**
 * A single hunk within a file diff, representing a contiguous
 * region of changed lines.
 */
export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: "add" | "del" | "context";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface FileDiff {
  filePath: string;
  status: "added" | "modified" | "deleted" | "renamed";
  oldPath?: string;
  hunks: DiffHunk[];
}

/**
 * Generates a structured diff between an epic's worktree branch and
 * the main branch (or a specified base).
 */
export async function getWorktreeDiff(
  worktreePath: string,
  baseBranch = "main"
): Promise<FileDiff[]> {
  const git = simpleGit(worktreePath);

  // Find the merge base so we only see the epic's changes
  let mergeBase: string;
  try {
    mergeBase = (await git.raw(["merge-base", baseBranch, "HEAD"])).trim();
  } catch {
    // If merge-base fails (e.g. unrelated histories), fall back to baseBranch
    mergeBase = baseBranch;
  }

  const rawDiff = await git.diff([mergeBase, "HEAD", "-U3"]);
  return parseUnifiedDiff(rawDiff);
}

/**
 * Parses a unified diff string into structured FileDiff objects.
 */
export function parseUnifiedDiff(raw: string): FileDiff[] {
  const files: FileDiff[] = [];
  if (!raw.trim()) return files;

  const lines = raw.split("\n");
  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New file header: diff --git a/path b/path
    if (line.startsWith("diff --git ")) {
      currentFile = null;
      currentHunk = null;

      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (!match) continue;

      const aPath = match[1];
      const bPath = match[2];

      currentFile = {
        filePath: bPath,
        status: "modified",
        hunks: [],
      };

      if (aPath !== bPath) {
        currentFile.status = "renamed";
        currentFile.oldPath = aPath;
      }

      files.push(currentFile);
      continue;
    }

    if (!currentFile) continue;

    // Detect added/deleted files
    if (line.startsWith("new file mode")) {
      currentFile.status = "added";
      continue;
    }
    if (line.startsWith("deleted file mode")) {
      currentFile.status = "deleted";
      continue;
    }

    // Skip index / --- / +++ headers
    if (
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename from") ||
      line.startsWith("rename to") ||
      line.startsWith("Binary files")
    ) {
      continue;
    }

    // Hunk header: @@ -old,count +new,count @@
    const hunkMatch = line.match(
      /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
    );
    if (hunkMatch) {
      const oldStart = parseInt(hunkMatch[1], 10);
      const oldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      const newStart = parseInt(hunkMatch[3], 10);
      const newLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;

      currentHunk = {
        oldStart,
        oldLines,
        newStart,
        newLines,
        lines: [],
      };
      currentFile.hunks.push(currentHunk);
      oldLine = oldStart;
      newLine = newStart;
      continue;
    }

    if (!currentHunk) continue;

    // Skip "\ No newline at end of file" marker
    if (line.startsWith("\\")) continue;

    // Diff lines
    if (line.startsWith("+")) {
      currentHunk.lines.push({
        type: "add",
        content: line.slice(1),
        oldLineNumber: null,
        newLineNumber: newLine,
      });
      newLine++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        type: "del",
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: null,
      });
      oldLine++;
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({
        type: "context",
        content: line.slice(1),
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine++;
      newLine++;
    }
    // Empty lines between hunks/files are ignored
  }

  return files;
}
