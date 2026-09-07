/**
 * B-arij-jcJeNQZnT1X9 — the two control rows `/projects/:id` draws above the
 * desk run off the right edge of a phone.
 *
 * The project route owns two rows the desk itself does not carry:
 *
 *   - `project-action-row` (app/projects/[projectId]/layout.tsx): New ·
 *     Night run · Sync from arji.json, drawn on the board route only;
 *   - `board-capture-bar` (app/projects/[projectId]/page.tsx): Full Auto ·
 *     Agent Refinement · the ⌘-click hint, inside the chat panel's slot — so
 *     it never has the viewport's width, only what is left beside the
 *     collapsed chat strip (44px + its border).
 *
 * Both were a FIXED-HEIGHT SINGLE FLEX LINE: `h-[46px]` / `h-[38px]` with no
 * `flex-wrap`, and every button `shrink-0`. On the capture bar the only
 * flexible child is the hint, so at 390px it was squeezed to an ellipsis
 * ("⌘-…") and Agent Refinement was painted against the bar's right edge; with
 * Full Auto armed (its badge adds "2 building · 1 reviewing") the second
 * button left the bar altogether, cut off by the `overflow-hidden` hosts.
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT.
 *
 * jsdom has no layout engine and does not load Tailwind, so it can measure
 * neither a box nor an overflow. What it CAN pin is the mechanism: a row that
 * cannot fold, a fixed height that would clip a second line even if it could,
 * and buttons that keep their labels intact. Those are string- and
 * structure-level facts about the markup and they all flip with the fix.
 *
 * THE RENDERED GEOMETRY — every control inside the viewport and hit-testable,
 * the hint drawn without an ellipsis, the desktop rows still one line tall —
 * is a visual claim and is measured in Chrome by
 * `e2e/project-desk-control-rows.spec.ts`. This file is not a substitute for
 * it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}
(globalThis as Record<string, unknown>).EventSource = MockEventSource;

const nav = vi.hoisted(() => ({
  pathname: "/projects/proj-1",
  push: vi.fn(),
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => nav.searchParams,
}));

vi.mock("@/components/github/GitHubConnectBanner", () => ({
  GitHubConnectBanner: () => null,
}));

vi.mock("@/hooks/useAgentPolling", () => ({
  useAgentPolling: () => ({ activities: [] }),
}));

vi.mock("@/hooks/useBatchSelection", () => ({
  useBatchSelection: () => {
    const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
    const clear = useCallback(() => setSelectedTicketIds([]), []);
    return {
      allSelected: new Set(selectedTicketIds),
      userSelected: new Set(selectedTicketIds),
      autoIncluded: new Set<string>(),
      selectedTicketIds,
      loading: false,
      setSelectedTicketIds,
      toggle: vi.fn(),
      clear,
      isAutoIncluded: () => false,
      isUserSelected: () => false,
    };
  },
}));

// The desk, the overlay, the dialogs and the chat panel all have their own
// tests; here they are the neighbours of the two rows, nothing more. The two
// buttons IN the capture bar stay real — the assertions below are about them.
vi.mock("@/components/desk/NowDesk", () => ({
  NowDesk: () => <div data-testid="board" />,
}));
vi.mock("@/components/ticket/TicketOverlay", () => ({ TicketOverlay: () => null }));
vi.mock("@/components/shared/NamedAgentSelect", () => ({
  NamedAgentSelect: () => null,
}));
vi.mock("@/components/chat/UnifiedChatPanel", () => ({
  UnifiedChatPanel: forwardRef(function UnifiedChatPanelMock(
    { children }: { children: ReactNode },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      openChat: vi.fn(),
      openNewEpic: vi.fn(),
      collapse: vi.fn(),
      hide: vi.fn(),
    }));
    return <div data-testid="unified-chat-panel">{children}</div>;
  }),
}));
vi.mock("@/components/night/NightRunDialog", () => ({ NightRunDialog: () => null }));
vi.mock("@/components/night/NightRunSummaryDialog", () => ({
  NightRunSummaryDialog: () => null,
}));
vi.mock("@/components/auto-mode/AutoModeDialog", () => ({ AutoModeDialog: () => null }));

import ProjectDeskPage from "@/app/projects/[projectId]/page";
import ProjectLayout from "@/app/projects/[projectId]/layout";

/* ------------------------------------------------------------------ */
/* Class-list helpers                                                  */
/* ------------------------------------------------------------------ */

function tokens(element: HTMLElement): string[] {
  return element.className.split(/\s+/).filter(Boolean);
}

/**
 * Does the class list carry `utility` with NO responsive prefix?
 *
 * Only the unprefixed token — the one that applies at 390px — decides; a
 * `lg:` variant proves nothing about a phone.
 */
function hasBaseUtility(element: HTMLElement, utility: string): boolean {
  return tokens(element).includes(utility);
}

/** The one unconditional `h-[Npx]` on the element, if any. */
function fixedHeight(element: HTMLElement): string | null {
  return tokens(element).find((token) => /^h-\[\d+px\]$/.test(token)) ?? null;
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks();
  nav.pathname = "/projects/proj-1";
  nav.searchParams = new URLSearchParams();
  window.history.replaceState(null, "", "/projects/proj-1");
  // Every status read the two buttons and the layout perform: an empty body
  // is "nothing armed, nothing running, no repo", which is the resting row.
  global.fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
});

async function renderCaptureBar(): Promise<HTMLElement> {
  render(<ProjectDeskPage />);
  const bar = await screen.findByTestId("board-capture-bar");
  // Both buttons read their status on mount; let those settle so nothing is
  // asserted against a half-mounted row.
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith("/api/projects/proj-1/auto-mode");
    expect(global.fetch).toHaveBeenCalledWith("/api/projects/proj-1/refinement");
  });
  return bar;
}

async function renderActionRow(): Promise<HTMLElement> {
  render(
    <ProjectLayout>
      <div data-testid="project-content" />
    </ProjectLayout>,
  );
  const row = await screen.findByTestId("project-action-row");
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalledWith("/api/projects/proj-1");
  });
  return row;
}

/* ------------------------------------------------------------------ */
/* The capture bar — Full Auto · Agent Refinement · the ⌘-click hint   */
/* ------------------------------------------------------------------ */

describe("the capture bar folds instead of running off a phone", () => {
  /**
   * The reported defect, at its root: one flex line that cannot become two.
   * With both buttons `shrink-0`, the line's min-content width is the two
   * buttons plus the gap (~280px at rest, ~400px with Full Auto's badge) and
   * the bar has ~301px of content width beside the collapsed chat strip at
   * 390px. Whatever does not fit is painted past the bar and clipped.
   */
  it("lets its children wrap onto a second line", async () => {
    const bar = await renderCaptureBar();

    expect(
      hasBaseUtility(bar, "flex-wrap"),
      "board-capture-bar is still a single flex line at every width, so at " +
        "390px the hint is an ellipsis and Agent Refinement is cut off",
    ).toBe(true);
    // Still a flex row on the desktop, and still centred on its one line.
    expect(hasBaseUtility(bar, "flex")).toBe(true);
    expect(hasBaseUtility(bar, "items-center")).toBe(true);
    expect(hasBaseUtility(bar, "shrink-0")).toBe(true);
  });

  /**
   * A row that folds needs room to fold into. `h-[46px]` is a ceiling: a
   * second line would be laid out below it and clipped by the same
   * `overflow-hidden` hosts, which is the original defect in a new place. The
   * desktop bar keeps exactly its 46px — a floor, not a fixed height.
   */
  it("keeps 46px as a floor rather than a ceiling", async () => {
    const bar = await renderCaptureBar();

    expect(
      fixedHeight(bar),
      "a fixed height clips the second line the wrap produces",
    ).toBeNull();
    expect(
      hasBaseUtility(bar, "min-h-[46px]"),
      "the desktop bar must stay 46px tall once the fixed height is gone",
    ).toBe(true);
  });

  /**
   * The whole reason the row exists is the two dispatch controls. They are
   * asserted by ACCESSIBLE NAME, so the test fails if a fix hides one of
   * them instead of re-laying the row out — and their labels never crush:
   * a button that shrank to fit would be as unreadable as one that left.
   */
  it("keeps Full Auto and Agent Refinement in the bar, named and whole", async () => {
    const bar = await renderCaptureBar();

    const fullAuto = within(bar).getByRole("button", { name: /Full Auto/ });
    const refinement = within(bar).getByRole("button", { name: /Agent Refinement/ });
    expect(fullAuto).toBeEnabled();
    expect(refinement).toBeEnabled();
    for (const button of [fullAuto, refinement]) {
      expect(
        hasBaseUtility(button, "shrink-0"),
        `${button.textContent?.trim()} must keep its label whole rather than shrink`,
      ).toBe(true);
    }
  });

  /**
   * The hint is what took the squeeze ("⌘-…"). Once the row wraps it has a
   * whole line to itself when it needs one; the ellipsis stays as the last
   * resort for a bar narrower than the hint itself, not as the everyday
   * rendering at 390px.
   */
  it("keeps the ⌘-click hint in the bar, pushed right, ellipsis as a last resort", async () => {
    const bar = await renderCaptureBar();

    const hint = within(bar).getByTestId("board-capture-hint");
    expect(hint.textContent).toMatch(/⌘/);
    expect(hasBaseUtility(hint, "ml-auto")).toBe(true);
    expect(hasBaseUtility(hint, "truncate")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* The action row — New · Night run · Sync from arji.json              */
/* ------------------------------------------------------------------ */

describe("the action row folds instead of running off a phone", () => {
  /**
   * Same shape, one row up: `h-[38px]` and no `flex-wrap`, three `shrink-0`
   * pills. It fits at 390px today (~270px of pills in 362px of content), so
   * this pins the mechanism rather than a defect seen — the day a fourth
   * control lands here it would clip exactly as the capture bar did.
   */
  it("lets its pills wrap and keeps 38px as a floor", async () => {
    const row = await renderActionRow();

    expect(
      hasBaseUtility(row, "flex-wrap"),
      "project-action-row is still a single flex line at every width",
    ).toBe(true);
    expect(fixedHeight(row), "a fixed height clips a wrapped line").toBeNull();
    expect(hasBaseUtility(row, "min-h-[38px]")).toBe(true);
    expect(hasBaseUtility(row, "flex")).toBe(true);
    expect(hasBaseUtility(row, "items-center")).toBe(true);
  });

  it("keeps New and Night run in the row, named and enabled", async () => {
    const row = await renderActionRow();

    expect(within(row).getByTestId("header-new-button")).toBeEnabled();
    expect(within(row).getByRole("button", { name: /Night run/ })).toBeEnabled();
  });
});
