"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ARIJ_MARKER } from "@/lib/markdown/markers";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  content: string;
}

/**
 * The one renderer for agent-written prose.
 *
 * Every discussion surface goes through it — chat bubbles, the ticket
 * description, QA report bodies, the ticket conversation and the story
 * thread — because what the agents write IS markdown: headings, lists,
 * `**bold**`, fenced code, and GFM tables. Rendered as plain text under
 * `whitespace-pre-wrap` a comment shows the reader its own syntax instead of
 * its meaning, which is the defect this component exists to close.
 *
 * Two details are load-bearing:
 *
 * - Arij's own markers are stripped, not rendered. react-markdown escapes raw
 *   HTML rather than parsing it, so an HTML comment — the form Arij's writers
 *   chose precisely to stay invisible — would otherwise print its tags
 *   (lib/markdown/markers.ts).
 * - A fenced block belongs to `pre`, whether or not it names a language. The
 *   inline/block branch used to be decided on the `language-*` class alone,
 *   which sent the common bare ``` fence down the inline path with the `pre`
 *   wrapper unwrapped: the block's line breaks collapsed into one run-on line.
 */
export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        ul: ({ children }) => (
          <ul className="list-disc ml-4 mb-2 space-y-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal ml-4 mb-2 space-y-1">{children}</ol>
        ),
        li: ({ children }) => <li>{children}</li>,
        code: ({ className, children }) => (
          <code className={cn("bg-muted px-1 py-0.5 rounded text-xs", className)}>
            {children}
          </code>
        ),
        // The block chrome, and the only place it lives. `[&_code]` undoes the
        // inline chrome above for the `code` element inside it; the descendant
        // selector outranks the utility it overrides.
        pre: ({ children }) => (
          <pre className="bg-muted rounded-md p-3 my-2 overflow-x-auto text-xs [&_code]:bg-transparent [&_code]:p-0 [&_code]:rounded-none">
            {children}
          </pre>
        ),
        h1: ({ children }) => (
          <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-sm font-bold mb-1.5 mt-2.5 first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-[13.5px] font-semibold mb-1 mt-2 first:mt-0">
            {children}
          </h4>
        ),
        h5: ({ children }) => (
          <h5 className="text-[13px] font-semibold mb-1 mt-1.5 first:mt-0">
            {children}
          </h5>
        ),
        h6: ({ children }) => (
          <h6 className="text-[12.5px] font-semibold mb-1 mt-1.5 first:mt-0">
            {children}
          </h6>
        ),
        hr: () => <hr className="border-border my-3" />,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-border pl-3 my-2 text-muted-foreground">
            {children}
          </blockquote>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {children}
          </a>
        ),
        // A table wider than its card scrolls instead of widening it. Borders
        // and padding sit on the table and reach the cells by descendant, so
        // the default `th`/`td` keep the alignment GFM parses out of the
        // delimiter row.
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="w-full border-collapse text-xs [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left">
              {children}
            </table>
          </div>
        ),
        // A pasted URL is a reachable case (agents link screenshots), and an
        // image with no ceiling pushes the card it is in past the viewport.
        img: ({ src, alt }) => (
          <img src={src} alt={alt} className="my-2 max-w-full rounded-md" />
        ),
      }}
    >
      {content.replace(ARIJ_MARKER, "")}
    </ReactMarkdown>
  );
}
