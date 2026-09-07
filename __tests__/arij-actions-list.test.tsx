/**
 * Session detail "Arij actions" list — compact rendering of the structured
 * board effects an agent session had (status changes, comments, questions,
 * findings, raw tool calls).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ArijActionsList,
  type ArijActionItem,
} from "@/components/shared/ArijActionsList";

const actions: ArijActionItem[] = [
  {
    kind: "tool_call",
    summary: "Read ticket state (get_ticket)",
    at: "2026-08-17T10:00:00.000Z",
  },
  {
    kind: "status_change",
    summary: "Ticket moved in_progress → review",
    detail: "Agent MCP: update_ticket_status",
    at: "2026-08-17T10:02:00.000Z",
  },
  {
    kind: "comment",
    summary: "Posted a comment",
    detail: "Implemented the schema change.",
    at: "2026-08-17T10:03:00.000Z",
  },
  {
    kind: "question",
    summary: "Asked the user a question",
    detail: "Should I migrate the legacy rows too?",
    at: null,
  },
  {
    kind: "findings",
    summary: "Submitted review findings (changes requested)",
    at: "2026-08-17T10:04:00.000Z",
  },
  {
    kind: "artifact",
    summary: "Attached visual proof",
    detail: "Checkout confirmation after payment",
    at: "2026-08-17T10:05:00.000Z",
  },
];

describe("ArijActionsList", () => {
  it("renders one entry per action with summary and detail", () => {
    render(<ArijActionsList actions={actions} />);

    expect(screen.getByTestId("arij-actions")).toBeInTheDocument();
    expect(screen.getByText("Arij actions")).toBeInTheDocument();

    expect(screen.getByTestId("arij-action-tool_call")).toHaveTextContent(
      "Read ticket state (get_ticket)"
    );
    expect(screen.getByTestId("arij-action-status_change")).toHaveTextContent(
      "Ticket moved in_progress → review"
    );
    expect(screen.getByTestId("arij-action-comment")).toHaveTextContent(
      "Implemented the schema change."
    );
    expect(screen.getByTestId("arij-action-question")).toHaveTextContent(
      "Should I migrate the legacy rows too?"
    );
    expect(screen.getByTestId("arij-action-findings")).toHaveTextContent(
      "Submitted review findings (changes requested)"
    );
    expect(screen.getByTestId("arij-action-artifact")).toHaveTextContent(
      "Checkout confirmation after payment"
    );
  });

  it("renders nothing when the session had no Arij actions", () => {
    const { container: empty } = render(<ArijActionsList actions={[]} />);
    expect(empty).toBeEmptyDOMElement();

    const { container: absent } = render(<ArijActionsList actions={null} />);
    expect(absent).toBeEmptyDOMElement();

    const { container: undef } = render(<ArijActionsList />);
    expect(undef).toBeEmptyDOMElement();
  });
});

describe("ArijActionsList keys", () => {
  it("keeps a row's DOM node when an earlier action is inserted in front of it", () => {
    const { rerender } = render(<ArijActionsList actions={actions} />);
    const commentBefore = screen.getByTestId("arij-action-comment");
    const findingsBefore = screen.getByTestId("arij-action-findings");

    // The live list re-sorts as chunk-parsed tool calls arrive: a get_ticket
    // read stamped before every durable row now heads the list, shifting
    // every existing row by one position.
    const earlier: ArijActionItem = {
      kind: "tool_call",
      summary: "Read ticket state (get_ticket)",
      at: "2026-08-17T09:59:00.000Z",
    };
    rerender(<ArijActionsList actions={[earlier, ...actions]} />);

    // With array-index keys React would hand the comment's content to the
    // node that used to render the status change, and so on down the list.
    expect(screen.getByTestId("arij-action-comment")).toBe(commentBefore);
    expect(screen.getByTestId("arij-action-findings")).toBe(findingsBefore);
    expect(screen.getAllByTestId("arij-action-tool_call")).toHaveLength(2);
  });

  it("renders repeated identical actions without a duplicate-key warning", () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const read: ArijActionItem = {
      kind: "tool_call",
      summary: "Read ticket state (get_ticket)",
      at: "2026-08-17T10:00:00.000Z",
    };
    render(<ArijActionsList actions={[read, read, read]} />);

    expect(screen.getAllByTestId("arij-action-tool_call")).toHaveLength(3);
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes("same key"))
    ).toBe(false);
    warn.mockRestore();
  });
});
