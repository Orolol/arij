import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "@/lib/git/diff";

describe("parseUnifiedDiff", () => {
  it("returns empty array for empty input", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
    expect(parseUnifiedDiff("  \n  ")).toEqual([]);
  });

  it("parses a simple modification diff", () => {
    // Note: in real unified diffs, blank context lines have a leading space
    const raw = [
      "diff --git a/src/app.ts b/src/app.ts",
      "index abc1234..def5678 100644",
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
      "@@ -1,3 +1,4 @@",
      ' import express from "express";',
      '+import cors from "cors";',
      " ",
      " const app = express();",
    ].join("\n");

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe("src/app.ts");
    expect(files[0].status).toBe("modified");
    expect(files[0].hunks).toHaveLength(1);

    const hunk = files[0].hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(3);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(4);

    // Check line types
    const types = hunk.lines.map((l) => l.type);
    expect(types).toEqual(["context", "add", "context", "context"]);

    // The added line should have a newLineNumber but no oldLineNumber
    const addedLine = hunk.lines.find((l) => l.type === "add")!;
    expect(addedLine.content).toBe('import cors from "cors";');
    expect(addedLine.newLineNumber).toBe(2);
    expect(addedLine.oldLineNumber).toBeNull();
  });

  it("parses an added file", () => {
    const raw = `diff --git a/README.md b/README.md
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/README.md
@@ -0,0 +1,2 @@
+# Hello
+World
`;

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].filePath).toBe("README.md");
    expect(files[0].status).toBe("added");
    expect(files[0].hunks).toHaveLength(1);

    const lines = files[0].hunks[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.type === "add")).toBe(true);
  });

  it("parses a deleted file", () => {
    const raw = `diff --git a/old.txt b/old.txt
deleted file mode 100644
index 1234567..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-Line 1
-Line 2
`;

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("deleted");
    expect(files[0].hunks[0].lines.every((l) => l.type === "del")).toBe(true);
  });

  it("parses a renamed file", () => {
    const raw = `diff --git a/old-name.ts b/new-name.ts
similarity index 90%
rename from old-name.ts
rename to new-name.ts
index abc1234..def5678 100644
--- a/old-name.ts
+++ b/new-name.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 3;
`;

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0].status).toBe("renamed");
    expect(files[0].filePath).toBe("new-name.ts");
    expect(files[0].oldPath).toBe("old-name.ts");
  });

  it("parses multiple files in a single diff", () => {
    const raw = `diff --git a/a.ts b/a.ts
index abc..def 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-old line
+new line
 unchanged
diff --git a/b.ts b/b.ts
new file mode 100644
index 0000000..abc 100644
--- /dev/null
+++ b/b.ts
@@ -0,0 +1 @@
+new file content
`;

    const files = parseUnifiedDiff(raw);
    expect(files).toHaveLength(2);
    expect(files[0].filePath).toBe("a.ts");
    expect(files[0].status).toBe("modified");
    expect(files[1].filePath).toBe("b.ts");
    expect(files[1].status).toBe("added");
  });

  it("correctly tracks line numbers across hunks", () => {
    const raw = `diff --git a/file.ts b/file.ts
index abc..def 100644
--- a/file.ts
+++ b/file.ts
@@ -10,3 +10,4 @@
 line 10
+inserted at 11
 line 11
 line 12
@@ -20,3 +21,2 @@
 line 20
-deleted at 21
 line 22
`;

    const files = parseUnifiedDiff(raw);
    const hunks = files[0].hunks;
    expect(hunks).toHaveLength(2);

    // First hunk
    expect(hunks[0].oldStart).toBe(10);
    expect(hunks[0].newStart).toBe(10);
    const addLine = hunks[0].lines.find((l) => l.type === "add")!;
    expect(addLine.newLineNumber).toBe(11);

    // Second hunk
    expect(hunks[1].oldStart).toBe(20);
    expect(hunks[1].newStart).toBe(21);
    const delLine = hunks[1].lines.find((l) => l.type === "del")!;
    expect(delLine.oldLineNumber).toBe(21);
  });
});
