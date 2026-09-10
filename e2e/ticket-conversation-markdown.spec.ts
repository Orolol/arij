import { expect, test } from "./fixtures/arij-project";
import { openTicketDetail } from "./fixtures/board";

/**
 * An agent's report is markdown, and the CONVERSATION band has to draw it.
 *
 * The band used to print a comment under `whitespace-pre-wrap`, so the reader
 * got `**Done.**`, `## What changed`, `| check | result |` and a fenced block's
 * indentation as literal characters — the syntax instead of what it says.
 *
 * The DOM half of this is pinned in `__tests__/comment-bubble.test.tsx`. What
 * only a browser can answer is whether the result FITS: a table is the one
 * markdown construct that can be wider than the card it is drawn in, and the
 * band is a fixed-width column inside a modal, so a wide table would either
 * push the modal open or be clipped away. Hence a real geometry check rather
 * than an element-presence one, and assertions on relations (this is inside
 * that) instead of pixel constants.
 */

const REPORT = [
  "**Done.** The fix is in `lib/agents/session.ts`.",
  "",
  "## What changed",
  "",
  "- redacted the token before logging it",
  "- added a regression test",
  "",
  "```",
  "npm test -- session-log",
  "npm test -- auth",
  "```",
  "",
  "> The CI log tail is truncated on purpose.",
  "",
  "| check | result |",
  "| --- | --- |",
  "| unit | green |",
  "| e2e | green |",
].join("\n");

test.describe("markdown in the ticket conversation", () => {
  test("draws an agent's report and keeps it inside its card", async ({
    page,
    project,
    request,
  }) => {
    const title = `Markdown ticket ${project.id}`;
    const created = await request.post(`/api/projects/${project.id}/epics`, {
      data: {
        title,
        description: "## Description\n\nWith **markdown** in it.",
      },
    });
    expect(
      created.ok(),
      `epic creation failed: ${created.status()} ${await created.text()}`
    ).toBeTruthy();
    const { data: epic } = (await created.json()) as { data: { id: string } };

    const comment = await request.post(
      `/api/projects/${project.id}/epics/${epic.id}/comments`,
      { data: { author: "agent", content: REPORT } }
    );
    expect(
      comment.ok(),
      `comment failed: ${comment.status()} ${await comment.text()}`
    ).toBeTruthy();

    await page.goto(project.boardUrl);
    const panel = await openTicketDetail(page, title);

    // Scoped to the agent's bubble: the ticket's own description is rendered
    // by the same component in the same panel.
    const bubble = panel
      .getByTestId("ticket-comment")
      .filter({ hasText: "What changed" });
    await expect(bubble).toBeVisible();

    // Rendered, not printed.
    await expect(bubble.locator("strong").first()).toHaveText("Done.");
    await expect(bubble.locator("h2")).toHaveText("What changed");
    await expect(bubble.locator("li")).toHaveCount(2);
    await expect(bubble.locator("pre code")).toContainText(
      "npm test -- session-log"
    );
    await expect(bubble.locator("blockquote")).toContainText(
      "The CI log tail is truncated on purpose."
    );
    await expect(bubble.locator("table th")).toHaveText(["check", "result"]);
    await expect(bubble.locator("table tbody tr")).toHaveCount(2);
    await expect(bubble).not.toContainText("**Done");
    await expect(bubble).not.toContainText("## What changed");
    await expect(bubble).not.toContainText("| check |");

    // ...and drawn inside the card it belongs to. The band caps its own
    // height and scrolls, so the table has to be scrolled to before it has a
    // geometry worth measuring.
    const table = bubble.locator("table");
    await table.scrollIntoViewIfNeeded();

    const [card, grid, band] = await Promise.all([
      bubble.boundingBox(),
      table.boundingBox(),
      panel.getByTestId("ticket-comment").first().locator("..").boundingBox(),
    ]);
    expect(card && grid && band, "missing geometry").toBeTruthy();

    expect(
      grid!.x >= band!.x - 1 && grid!.x + grid!.width <= band!.x + band!.width + 1,
      `the table escapes its column (table ${JSON.stringify(grid)}, column ${JSON.stringify(band)})`
    ).toBe(true);
    expect(
      grid!.width <= card!.width + 1,
      `the table is wider than the bubble it is drawn in (table ${grid!.width}px, bubble ${card!.width}px)`
    ).toBe(true);
  });
});
