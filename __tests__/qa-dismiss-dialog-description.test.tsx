/**
 * The Dismiss dialog announces WHICH finding it is about to reject.
 *
 * A dialog whose only accessible text is its title says "Dismiss this finding"
 * and nothing else: a screen reader user is asked to confirm a destructive-ish
 * write against a finding they were never told the identity of. The dialog
 * already paints the finding's text — this pins that the painted text is also
 * the dialog's accessible DESCRIPTION, not just pixels next to it.
 *
 * WHY THE ASSERTIONS QUERY BY ROLE AND NOT BY TESTID. A testid proves a node
 * exists; it proves nothing about the accessibility tree, which is the entire
 * subject here. `getByRole("dialog", { name })` and `toHaveAccessibleDescription`
 * resolve `aria-labelledby` / `aria-describedby` the way a screen reader does,
 * so they fail exactly when the a11y wiring is missing.
 *
 * THE CONSOLE ASSERTION IS THE ORIGINAL BUG REPORT. Radix emits
 * `Warning: Missing \`Description\` or \`aria-describedby={undefined}\` for
 * {DialogContent}.` on every open of a description-less dialog — it points
 * `aria-describedby` at an id nothing renders. That warning goes to
 * `console.warn` (the sibling title warning is the one on `console.error`), so
 * the spy has to watch `warn`.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { DismissDialog } from "@/components/qa/DismissDialog";
import type { QaFinding } from "@/lib/qa/types";

function finding(overrides: Partial<QaFinding> = {}): QaFinding {
  return {
    findingId: "f1",
    epicId: "e1",
    projectId: "p1",
    readableId: "ARJ-113",
    ticketTitle: "Named agents",
    text: "Le token MCP est loggé en clair quand la session échoue",
    filePath: "lib/agents/session.ts",
    lineNumber: 214,
    severity: "critical",
    severityLabel: "BLOCKING",
    tier: "blocking",
    blocking: true,
    reviewer: "Security CC",
    reviewerAgentType: "review_security",
    filedAt: new Date(Date.now() - 6 * 60_000).toISOString(),
    fixable: true,
    rawBody: "[critical] Le token MCP est loggé en clair quand la session échoue",
    ...overrides,
  };
}

function renderDialog(target: QaFinding | null) {
  return render(
    <DismissDialog
      finding={target}
      open
      onOpenChange={() => {}}
      onConfirm={() => {}}
    />,
  );
}

/** The exact string Radix builds in `DescriptionWarning`. */
const RADIX_WARNING = "Missing `Description` or `aria-describedby={undefined}`";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DismissDialog — the accessible description", () => {
  it("describes the dialog with the finding it is about to dismiss", () => {
    const target = finding();
    renderDialog(target);

    const dialog = screen.getByRole("dialog", { name: "Dismiss this finding" });
    expect(dialog).toHaveAccessibleDescription(target.text);
  });

  it("carries the description of whichever finding it was opened on", () => {
    const target = finding({
      findingId: "f2",
      text: "The clone deletion guard trusts a path it never contained",
    });
    renderDialog(target);

    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(target.text);
  });

  it("emits no Radix description warning when opened", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderDialog(finding());

    const warnings = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.includes(RADIX_WARNING));
    expect(warnings).toEqual([]);
  });

  /*
    The degenerate state the props allow. QaScreen drives `open` off
    `dismissTarget !== null`, so it never reaches this — but the component
    accepts `finding: null` with `open`, and there Radix must be told there is
    nothing to describe rather than left pointing at an id that never renders.
  */
  it("takes Radix's opt-out instead of warning when there is no finding", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderDialog(null);

    const warnings = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((message) => message.includes(RADIX_WARNING));
    expect(warnings).toEqual([]);
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-describedby");
  });
});
