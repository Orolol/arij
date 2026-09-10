/**
 * Review findings are agent prose too.
 *
 * `submit_findings` writes a reviewer's body straight into `review_comments`,
 * and reviewers write markdown — `**Blocking**: the token is logged in
 * \`lib/a.ts\``. Both surfaces that draw one printed it under
 * `whitespace-pre-wrap`, so the reader saw the asterisks and the backticks.
 * They now share the app's renderer.
 *
 * The Back-to-Dev dialog is pinned as well as the inline thread: it is the
 * surface where a human checks what is about to be sent back, so showing it
 * as syntax rather than as the finding is a reading failure in the one place
 * the reader has to agree with the text.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { InlineCommentThread } from "@/components/review/InlineCommentThread";
import { ReviewActions } from "@/components/review/ReviewActions";
import type { ReviewComment } from "@/hooks/useReviewComments";

const BODY = "**Blocking.** The token is written in clear in `lib/agents/session.ts`.";

function reviewComment(overrides: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id: "rc1",
    epicId: "e1",
    filePath: "lib/agents/session.ts",
    lineNumber: 214,
    body: BODY,
    author: "agent",
    status: "open",
    agentSessionId: null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  } as ReviewComment;
}

describe("review findings", () => {
  it("renders a finding's markdown in the inline thread", () => {
    render(
      <InlineCommentThread
        comments={[reviewComment()]}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText("Blocking.").tagName).toBe("STRONG");
    expect(screen.getByText("lib/agents/session.ts").tagName).toBe("CODE");
    expect(screen.queryByText(/\*\*Blocking/)).toBeNull();
  });

  it("renders the same finding as markdown in the Back-to-Dev preview", async () => {
    render(
      <ReviewActions
        projectId="p1"
        epicId="e1"
        epicStatus="review"
        openCount={1}
        comments={[reviewComment()]}
        onBackToDev={vi.fn()}
        onMerge={vi.fn()}
        onResolveAll={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Back to Dev" }));

    const dialog = await screen.findByRole("dialog", { name: "Send Back to Dev" });
    expect(dialog.textContent).not.toContain("**Blocking");
    expect(screen.getByText("Blocking.").tagName).toBe("STRONG");
  });
});
