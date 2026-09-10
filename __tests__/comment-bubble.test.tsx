/**
 * The CONVERSATION band's bubble — where every agent report actually lands.
 *
 * What agents write here is markdown, and it used to be printed as plain text
 * under `whitespace-pre-wrap`: the reader got `**Done** — see `lib/a.ts`` and a
 * wall of `##` headings instead of what those characters mean. The body now
 * goes through the shared renderer, which also gives a pipeline red→green
 * report its structured block here (as the ticket feed already did) and keeps
 * Arij's own markers off the screen.
 *
 * The collapsed preview is pinned too: the reader sees it by default, so it is
 * the one rendering of a long comment that must not arrive malformed.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CommentBubble } from "@/components/ticket/CommentBubble";
import { LONG_COMMENT_THRESHOLD } from "@/lib/kanban/activity-feed";
import { formatRegressionReportComment } from "@/lib/verify/regression-report";
import type { TicketComment } from "@/hooks/useTicketComments";

function comment(overrides: Partial<TicketComment> = {}): TicketComment {
  return {
    id: "c1",
    epicId: "e1",
    userStoryId: null,
    author: "agent",
    content: "hello",
    agentSessionId: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  } as TicketComment;
}

describe("the conversation bubble", () => {
  it("renders the markdown an agent wrote", () => {
    render(
      <CommentBubble
        comment={comment({
          content: "**Done.** The fix is in `lib/a.ts`.\n\n- one\n- two",
        })}
      />
    );

    expect(screen.getByText("Done.").tagName).toBe("STRONG");
    expect(screen.getByText("lib/a.ts").tagName).toBe("CODE");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText(/\*\*Done/)).toBeNull();
  });

  it("renders a fenced block as a block, newlines intact", () => {
    render(
      <CommentBubble
        comment={comment({
          content: "Reproduced with:\n\n```\nnpm test -- a\nnpm test -- b\n```",
        })}
      />
    );

    const code = screen.getByText(/npm test -- a/);
    expect(code.closest("pre")).not.toBeNull();
    expect(code.textContent).toContain("\n");
  });

  it("gives a pipeline verify report its structured block once expanded", async () => {
    const content = formatRegressionReportComment({
      regression: {
        status: "passed",
        reason: null,
        detail: null,
        testFiles: ["src/auth.test.ts"],
        checkedAt: "2026-09-07T10:00:00.000Z",
      },
    });
    // Long enough to arrive collapsed, which is how a real report lands.
    expect(content.length).toBeGreaterThan(LONG_COMMENT_THRESHOLD);

    const { container } = render(<CommentBubble comment={comment({ content })} />);

    // Collapsed: the preview is readable prose, and the marker that introduces
    // the report is never printed.
    expect(container.textContent).not.toContain("arij:");
    expect(screen.queryByTestId("regression-report-block")).toBeNull();

    await userEvent.click(screen.getByTestId("ticket-comment-expand"));

    expect(screen.getByTestId("regression-report-block")).toBeInTheDocument();
    expect(container.textContent).not.toContain("arij:");
  });

  it("collapses a long comment behind a preview the renderer can parse", async () => {
    const content = `Build failed.\n\n\`\`\`\n${"cargo test output ".repeat(80)}TAIL.`;
    expect(content.length).toBeGreaterThan(LONG_COMMENT_THRESHOLD);

    const { container } = render(<CommentBubble comment={comment({ content })} />);

    const collapsed = container.textContent ?? "";
    expect(collapsed).toContain("cargo test output");
    expect(collapsed).not.toContain("TAIL.");
    // The dangling block is closed rather than left to swallow the ellipsis.
    expect(collapsed).toContain("…");
    expect(
      container.querySelectorAll("pre code").length,
      "the truncated block renders as a code block"
    ).toBe(1);

    await userEvent.click(screen.getByTestId("ticket-comment-expand"));
    expect(container.textContent).toContain("TAIL.");
  });

  it("draws no expand affordance for a comment that fits", () => {
    render(<CommentBubble comment={comment({ content: "short note" })} />);
    expect(screen.queryByTestId("ticket-comment-expand")).toBeNull();
  });
});
