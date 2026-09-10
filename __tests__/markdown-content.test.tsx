/**
 * The shared markdown renderer — what an agent's prose is turned into.
 *
 * Three behaviours here are the reason the component is worth a test rather
 * than a smoke render, and each was wrong or missing before this epic:
 *
 * - A BARE ``` FENCE IS A BLOCK. The inline/block branch used to be decided on
 *   the `language-*` class alone, and a fence with no language tag carries none
 *   — so the commonest form of code block in an agent's answer was rendered as
 *   inline `<code>` under a `pre` wrapper that the renderer then threw away.
 *   The newlines went with it: the whole block collapsed onto one line.
 * - ARIJ'S OWN MARKERS ARE NOT PRINTED. react-markdown without `rehype-raw`
 *   escapes raw HTML rather than parsing it, so `<!-- arij:regression-report -->`
 *   — written precisely to be invisible — reached the screen as text.
 * - RAW HTML IS STILL NEVER PARSED. That is the invariant the strip above
 *   depends on, and the reason `content` is handled as markdown, not as HTML:
 *   an agent that pastes a tag gets the tag's characters on screen, never a
 *   live element.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MarkdownContent } from "@/components/chat/MarkdownContent";

/** The `<pre>` an element sits in, or null when it is not in a code block. */
function blockAround(element: HTMLElement): HTMLElement | null {
  return element.closest("pre");
}

describe("markdown rendering of agent prose", () => {
  it("renders a fence with no language tag as a block, keeping its line breaks", () => {
    render(
      <MarkdownContent
        content={"Intro line.\n\n```\nconst a = 1;\nconst b = 2;\n```\n\nOutro."}
      />
    );

    const code = screen.getByText(/const a = 1;/);
    expect(blockAround(code)).not.toBeNull();
    expect(code.textContent).toContain("\n");
  });

  it("renders a language-tagged fence as a block too", () => {
    render(<MarkdownContent content={"```ts\nconst a = 1;\n```"} />);
    expect(blockAround(screen.getByText(/const a = 1;/))).not.toBeNull();
  });

  it("keeps a single backtick span inline", () => {
    render(<MarkdownContent content={"Run `npm test` before pushing."} />);

    const code = screen.getByText("npm test");
    expect(blockAround(code)).toBeNull();
  });

  it("renders the inline syntax an agent actually writes", () => {
    render(
      <MarkdownContent
        content={[
          "## Findings",
          "",
          "- **broken** import in `lib/a.ts`",
          "- ~~stale~~ claim",
          "",
          "| file | line |",
          "| --- | --- |",
          "| lib/a.ts | 12 |",
        ].join("\n")}
      />
    );

    expect(screen.getByRole("heading", { name: "Findings" })).toBeInTheDocument();
    expect(screen.getByText("broken").tagName).toBe("STRONG");
    expect(screen.getByText("stale").tagName).toBe("DEL");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "lib/a.ts" })).toBeInTheDocument();
  });

  it("renders Arij's own markers as nothing at all", () => {
    const { container } = render(
      <MarkdownContent
        content={
          "<!-- arij:regression-report -->\n\n## Verify report\n\n**PASSED**\n\n" +
          "<!-- arij:dead-session=abc123 -->\n\nDone."
        }
      />
    );

    expect(container.textContent).not.toContain("arij:");
    expect(screen.getByText(/Verify report/)).toBeInTheDocument();
    expect(screen.getByText("Done.")).toBeInTheDocument();
  });

  it("leaves an HTML comment of the agent's own alone in the text it is escaped into", () => {
    // Only Arij's prefix is stripped. A comment mentioning someone else's
    // marker must not be silently emptied — it is escaped, which is loud.
    const { container } = render(
      <MarkdownContent content={"<!-- ci:retry -->\n\nafter"} />
    );

    expect(container.textContent).toContain("<!-- ci:retry -->");
  });

  it("never turns pasted HTML into live elements", () => {
    const { container } = render(
      <MarkdownContent
        content={'<img src="x" onerror="globalThis.__pwned = 1"><script>1</script>'}
      />
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect((globalThis as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
