import { commentPreview, LONG_COMMENT_THRESHOLD } from "@/lib/kanban/activity-feed";
import { ARIJ_MARKER } from "@/lib/markdown/markers";

/**
 * A truncated comment, still fit to be parsed as markdown.
 *
 * `commentPreview` cuts raw text on a word boundary, which is exactly right
 * for the plain-text feed it was written for and exactly wrong once the result
 * is handed to the markdown renderer: a cut that lands inside a fenced block
 * leaves the fence open, and everything after it — the rest of the preview and
 * the ellipsis — is drawn as code.
 *
 * Two smaller consequences of the same move, resolved here rather than left to
 * the renderer:
 *
 * - Arij's own markers are dropped before the cut counts characters, so the
 *   preview does not spend its budget on bookkeeping and then print it.
 * - The whitespace is deliberately NOT collapsed. A preview keeps whatever
 *   shape the comment had — headings, list bullets, a fenced payload — because
 *   shape is what the reader scans for, and flattening it turns a list into one
 *   run-on line and a JSON block into a wall of text.
 */

/** A line that OPENS a fenced block: up to three spaces, then ``` or ~~~. */
const FENCE_OPENER = /^ {0,3}(`{3,}|~{3,})/;

/** A line that CLOSES one: the fence and nothing else. */
const FENCE_CLOSER = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** The word-boundary preview of `content`, ready to be parsed as markdown. */
export function markdownPreview(
  content: string,
  max: number = LONG_COMMENT_THRESHOLD
): string {
  return closeOpenCodeFence(
    commentPreview(content.replace(ARIJ_MARKER, ""), max)
  );
}

/**
 * Appends the closing fence a truncated block is missing — the block is then
 * drawn as a code block, honestly cut, instead of swallowing the ellipsis and
 * every line after it.
 *
 * The open block is found by scanning lines rather than by counting delimiters,
 * because the two fence characters do not close each other: a ``` line inside a
 * ~~~ block is content, and the triple backticks this module's own doc comment
 * mentions must not read as a fence either. Only a line whose whole content is
 * a fence counts, which is what CommonMark requires.
 */
function closeOpenCodeFence(text: string): string {
  let open: "`" | "~" | null = null;

  for (const line of text.split("\n")) {
    if (open === null) {
      const opening = FENCE_OPENER.exec(line);
      if (opening) open = opening[1][0] as "`" | "~";
      continue;
    }
    const closing = FENCE_CLOSER.exec(line);
    if (closing && closing[1][0] === open) open = null;
  }

  return open === null ? text : `${text}\n${open.repeat(3)}`;
}
