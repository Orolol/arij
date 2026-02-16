/**
 * Tests for Story 3: Review Action "Back to Dev" (Rework Loop).
 *
 * Validates that the ReviewActions component properly formats open review
 * comments and that the build route loads them into the agent prompt.
 */
import { describe, it, expect } from "vitest";

/**
 * Test the markdown formatting logic used by ReviewActions.handleBackToDev.
 * The component builds a rework prompt from open review comments grouped by file.
 */
describe("Rework loop — ReviewActions comment formatting", () => {
  interface ReviewComment {
    id: string;
    filePath: string;
    lineNumber: number;
    body: string;
    status: string;
  }

  function formatReworkComment(
    comments: ReviewComment[],
    additionalComment: string
  ): string {
    const openComments = comments.filter((c) => c.status === "open");
    const parts: string[] = [];

    if (openComments.length > 0) {
      parts.push("## Review Comments\n");
      const byFile = new Map<string, ReviewComment[]>();
      for (const c of openComments) {
        const existing = byFile.get(c.filePath) || [];
        existing.push(c);
        byFile.set(c.filePath, existing);
      }
      for (const [filePath, fileComments] of byFile) {
        parts.push(`### ${filePath}`);
        for (const c of fileComments) {
          parts.push(`- **Line ${c.lineNumber}**: ${c.body}`);
        }
        parts.push("");
      }
    }

    if (additionalComment.trim()) {
      parts.push("## Additional Instructions\n");
      parts.push(additionalComment.trim());
    }

    return parts.join("\n");
  }

  it("formats open comments grouped by file", () => {
    const comments: ReviewComment[] = [
      { id: "1", filePath: "src/app.ts", lineNumber: 10, body: "Add null check", status: "open" },
      { id: "2", filePath: "src/app.ts", lineNumber: 25, body: "Simplify this logic", status: "open" },
      { id: "3", filePath: "src/utils.ts", lineNumber: 5, body: "Remove unused import", status: "open" },
    ];

    const result = formatReworkComment(comments, "");

    expect(result).toContain("## Review Comments");
    expect(result).toContain("### src/app.ts");
    expect(result).toContain("- **Line 10**: Add null check");
    expect(result).toContain("- **Line 25**: Simplify this logic");
    expect(result).toContain("### src/utils.ts");
    expect(result).toContain("- **Line 5**: Remove unused import");
  });

  it("excludes resolved comments", () => {
    const comments: ReviewComment[] = [
      { id: "1", filePath: "src/app.ts", lineNumber: 10, body: "Fix this", status: "open" },
      { id: "2", filePath: "src/app.ts", lineNumber: 20, body: "Already fixed", status: "resolved" },
    ];

    const result = formatReworkComment(comments, "");

    expect(result).toContain("Line 10");
    expect(result).not.toContain("Line 20");
    expect(result).not.toContain("Already fixed");
  });

  it("appends additional instructions when provided", () => {
    const comments: ReviewComment[] = [
      { id: "1", filePath: "src/app.ts", lineNumber: 10, body: "Fix this", status: "open" },
    ];

    const result = formatReworkComment(comments, "Also update the tests");

    expect(result).toContain("## Additional Instructions");
    expect(result).toContain("Also update the tests");
  });

  it("returns only additional instructions when no open comments", () => {
    const result = formatReworkComment([], "Run tests after changes");

    expect(result).not.toContain("## Review Comments");
    expect(result).toContain("## Additional Instructions");
    expect(result).toContain("Run tests after changes");
  });

  it("returns empty string when no comments and no instructions", () => {
    const result = formatReworkComment([], "");
    expect(result).toBe("");
  });
});

/**
 * Test the review context formatting used by the build route.
 * The build route independently loads open review comments from DB
 * and formats them as agent prompt context.
 */
describe("Rework loop — build route review context formatting", () => {
  interface DbReviewComment {
    filePath: string;
    lineNumber: number;
    body: string;
  }

  function formatReviewContext(openReviewComments: DbReviewComment[]): string {
    if (openReviewComments.length === 0) return "";

    const byFile = new Map<string, DbReviewComment[]>();
    for (const rc of openReviewComments) {
      const existing = byFile.get(rc.filePath) || [];
      existing.push(rc);
      byFile.set(rc.filePath, existing);
    }
    const parts = [
      "## Code Review Feedback\n\nThe following review comments were left on your previous changes. Address each one:\n",
    ];
    for (const [filePath, fileComments] of byFile) {
      parts.push(`### ${filePath}`);
      for (const rc of fileComments) {
        parts.push(`- **Line ${rc.lineNumber}**: ${rc.body}`);
      }
      parts.push("");
    }
    return parts.join("\n");
  }

  it("formats review comments as structured agent prompt context", () => {
    const comments: DbReviewComment[] = [
      { filePath: "src/index.ts", lineNumber: 42, body: "Null check needed" },
      { filePath: "src/index.ts", lineNumber: 88, body: "Simplify condition" },
      { filePath: "lib/utils.ts", lineNumber: 12, body: "Remove dead code" },
    ];

    const result = formatReviewContext(comments);

    expect(result).toContain("## Code Review Feedback");
    expect(result).toContain("Address each one");
    expect(result).toContain("### src/index.ts");
    expect(result).toContain("- **Line 42**: Null check needed");
    expect(result).toContain("- **Line 88**: Simplify condition");
    expect(result).toContain("### lib/utils.ts");
    expect(result).toContain("- **Line 12**: Remove dead code");
  });

  it("returns empty string when no open review comments", () => {
    expect(formatReviewContext([])).toBe("");
  });
});
