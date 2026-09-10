/**
 * The collapsed view of a long comment.
 *
 * A comment over `LONG_COMMENT_THRESHOLD` draws `markdownPreview(comment.content)`
 * and nothing else until the reader expands it — so the preview is the default
 * rendering of every long agent report, and it is now parsed as markdown rather
 * than printed as text. `commentPreview` alone is not enough for that:
 *
 * - A cut inside a fenced block leaves the fence open, and everything after it
 *   — the rest of the preview and the ellipsis — draws as code.
 * - Arij's markers are not prose. Left in, they eat the preview's character
 *   budget and then print as bookkeeping the reader was never meant to see.
 *
 * The stored comment is untouched: expanding renders it in full.
 */

import { describe, expect, it } from "vitest";

import { LONG_COMMENT_THRESHOLD } from "@/lib/kanban/activity-feed";
import { markdownPreview } from "@/lib/markdown/preview";

/** A comment that is already over the threshold before its fence opens. */
const LONG_PROSE = "the build failed on the merge base ".repeat(20);

const fenceLines = (text: string) =>
  text.split("\n").filter((line) => /^ {0,3}(?:`{3,}|~{3,})/.test(line));

describe("markdownPreview", () => {
  it("closes a fence the truncation cut in half, so nothing after it is code", () => {
    // The fence opens INSIDE the preview window: a cut that lands after the
    // opener is what leaves a block dangling, and a comment whose fence sits
    // past the cut would prove nothing.
    const content = `Build failed.\n\n\`\`\`\n${"cargo test output ".repeat(80)}\n\`\`\``;

    const preview = markdownPreview(content);

    expect(content.length).toBeGreaterThan(LONG_COMMENT_THRESHOLD);
    expect(preview.length).toBeLessThan(content.length);
    expect(preview).toContain("…");
    // Balanced: one opener, one closer, and the closer is last.
    expect(fenceLines(preview)).toHaveLength(2);
    expect(preview.trimEnd().endsWith("```")).toBe(true);
  });

  it("keeps the shape of a structured comment rather than flattening it", () => {
    const content = [
      "## Verify report",
      "",
      `- Test files detected: \`src/a.test.ts\`, \`src/b.test.ts\` ${"and more ".repeat(40)}`,
      "",
      "- Checked at: 2026-09-07T10:00:00.000Z",
    ].join("\n");

    const preview = markdownPreview(content);

    expect(preview.startsWith("## Verify report\n\n")).toBe(true);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("does not double the fence of a block the cut did not touch", () => {
    const content = "Intro.\n\n```\nshort block\n```\n\nTail.";
    expect(markdownPreview(content)).toBe(content);
  });

  it("drops Arij's markers, which the reader was never meant to see", () => {
    expect(markdownPreview(`<!-- arij:regression-report -->\n\n${LONG_PROSE}`)).not.toContain(
      "arij:"
    );
  });

  it("leaves a short comment exactly as it was", () => {
    expect(markdownPreview("one   line\ncounts")).toBe("one   line\ncounts");
  });

  it("still cuts on a word boundary", () => {
    const preview = markdownPreview("word ".repeat(LONG_COMMENT_THRESHOLD));

    expect(preview.endsWith("…")).toBe(true);
    expect(preview.startsWith("word word ")).toBe(true);
  });
});
