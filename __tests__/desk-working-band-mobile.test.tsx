/**
 * B-arij-HZofmlKjLzmM — the WORKING band keeps three columns on a phone, and
 * the QUEUED / TODAY tiles are crushed.
 *
 * MEASURED IN CHROME on the unfixed band (2026-09-07, `channel: "chrome"`,
 * `e2e/desk-working-band-mobile.spec.ts` run against the merge-base file,
 * 2 queued · today `$1.42 · 2 projets · 9 sessions` · six YOUR TURN signals):
 *
 *   390×844   the grid is 326px wide and still `grid-cols-3`: three columns of
 *             101.3px, and the inline "1fr 1fr" splits the 125.5px grid into
 *             two 57.3px rows, so each tile is a 101.3×57.3 box. That is the
 *             ticket's capture: the TODAY footer (`$1.42 · 2 projets ·
 *             9 sessions`) gone and the QUEUED kicker on two lines. On
 *             `/projects/:id`, 44px narrower, the columns are 86.7px.
 *   1280/1440 clean — three columns of 398px and 451.3px, two rows of 77.4px.
 *
 * WHAT THIS FILE PROVES, AND WHAT IT DOES NOT.
 *
 * jsdom has no layout engine and does not load Tailwind, so it can measure
 * neither a column nor a clamped line. What it CAN pin is the mechanism: a
 * `grid-cols-3` with no breakpoint, and an inline `grid-template-rows` that
 * is computed from three columns and applied at every width. Both are
 * string-level facts about the markup, and both flip with the fix.
 *
 * THE RENDERED GEOMETRY — one column at 390, two at 768, three at 1280/1440,
 * every cell wider than 300px on a phone, the TODAY footer unclamped and the
 * QUEUED kicker on one line — is a visual claim and is measured in a real
 * browser by `e2e/desk-working-band-mobile.spec.ts`. This file is not a
 * substitute for it.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

import { WorkingBand } from "@/components/desk/WorkingBand";
import { deriveProjects } from "@/lib/control-desk/aggregate";
import type {
  DeskQueuedSession,
  DeskToday,
  DeskWorkingSession,
} from "@/lib/control-desk/types";

const projects = deriveProjects([{ id: "p1", name: "Arij", createdAt: "2026-01-01" }]);
const projectsById = new Map(projects.map((p) => [p.id, p]));

const TODAY: DeskToday = {
  ticketsShipped: 3,
  failedSessions: 1,
  costUsd: 1.42,
  projects: 2,
  sessions: 9,
};

function live(index: number): DeskWorkingSession {
  return {
    sessionId: `s${index}`,
    projectId: "p1",
    epicId: `e${index}`,
    readableId: `F-arij-${120 + index}`,
    title: "Now mobile : la bande WORKING garde 3 colonnes à 390 px",
    taskType: "BUILD",
    agentName: "Opus Builder",
    startedAt: new Date(Date.now() - 252_000).toISOString(),
    lastLogLine: "editing components/desk/WorkingBand.tsx (+18 −6)",
    nightRun: false,
    stale: false,
  };
}

function queued(index: number): DeskQueuedSession {
  return {
    sessionId: `q${index}`,
    projectId: "p1",
    epicId: `e${900 + index}`,
    readableId: `F-arij-${900 + index}`,
    title: "Inline review findings in the ticket overlay",
  };
}

function renderGrid(props: Partial<ComponentProps<typeof WorkingBand>> = {}): HTMLElement {
  render(
    <WorkingBand
      working={[]}
      queued={[queued(1), queued(2)]}
      today={TODAY}
      projectsById={projectsById}
      {...props}
    />,
  );
  return screen.getByTestId("desk-working-grid");
}

/* ------------------------------------------------------------------ */
/* Class-list helpers — the same reading as desk-mobile-layout.test    */
/* ------------------------------------------------------------------ */

function tokens(element: HTMLElement): string[] {
  return element.className.split(/\s+/).filter(Boolean);
}

/**
 * Does the class list carry `utility` with NO responsive prefix?
 *
 * The desktop grid keeps `lg:grid-cols-3`, so a plain `includes("grid-cols-3")`
 * would pass on the fixed markup too and prove nothing. Only the unprefixed
 * token — the one that applies at 390px — decides.
 */
function hasBaseUtility(element: HTMLElement, utility: string): boolean {
  return tokens(element).includes(utility);
}

/** Does the class list carry `variant:utility` exactly? */
function hasVariant(element: HTMLElement, variant: string, utility: string): boolean {
  return tokens(element).includes(`${variant}:${utility}`);
}

/** The custom property React set on the element, or the empty string. */
function customProperty(element: HTMLElement, name: string): string {
  return element.style.getPropertyValue(name).trim();
}

/* ------------------------------------------------------------------ */
/* Columns                                                             */
/* ------------------------------------------------------------------ */

describe("WORKING grid — one column on a phone, two from sm, three from lg", () => {
  /**
   * The reported defect, at its root. `grid-cols-3` with no breakpoint gives
   * a 326px band three columns of 98.7px, and the two tiles plus every live
   * card inherit that width whatever the viewport.
   */
  it.each([
    ["no live session", 0],
    ["one live session", 1],
    ["four live sessions", 4],
  ])("does not keep three columns at every width with %s", (_label, count) => {
    const grid = renderGrid({ working: Array.from({ length: count }, (_, i) => live(i)) });

    expect(
      hasBaseUtility(grid, "grid-cols-3"),
      "the grid is still three columns at 390px, where each one measured 98.7px",
    ).toBe(false);
    expect(hasBaseUtility(grid, "grid-cols-1"), "a phone gets one column").toBe(true);
    expect(hasVariant(grid, "sm", "grid-cols-2"), "a tablet gets two columns from sm").toBe(
      true,
    );
    expect(hasVariant(grid, "lg", "grid-cols-3"), "the desktop keeps its three").toBe(true);
  });

  it("keeps the frame's gap, growth and scroll rules", () => {
    const grid = renderGrid({ working: [live(0)] });
    for (const utility of ["grid", "min-h-0", "flex-1", "gap-[11px]", "overflow-y-auto"]) {
      expect(hasBaseUtility(grid, utility), `${utility} was dropped from the grid`).toBe(true);
    }
  });

  it("still renders every live card before the two tiles, whatever the column count", () => {
    const grid = renderGrid({ working: [live(0), live(1)] });
    const cells = [...grid.children].map((cell) => cell.getAttribute("data-testid"));
    expect(cells).toEqual([
      "desk-live-session",
      "desk-live-session",
      "desk-queued-tile",
      "desk-today-tile",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

describe("WORKING grid — the three-column row frame applies only where three columns do", () => {
  /**
   * The inline `grid-template-rows` was computed from `Math.ceil(cells / 3)`
   * and applied at every width. At 390px that is "1fr 1fr" for a ONE-column
   * grid: the two rows split a ~130px box, so the TODAY tile (92px of
   * content) sat in a 60px row and its footer was painted outside it.
   */
  it.each([0, 1, 5])("sets no unconditional inline row template with %i live session(s)", (count) => {
    const grid = renderGrid({ working: Array.from({ length: count }, (_, i) => live(i)) });
    expect(
      grid.style.gridTemplateRows,
      `with ${count} live session(s) the grid still carries an inline row template ` +
        `computed for three columns, and it applies on a phone too`,
    ).toBe("");
  });

  /**
   * The desktop frame is unchanged to the value: two equal rows up to six
   * cells, then rows of at least 150px. It just travels through a custom
   * property that only the `lg` variant reads.
   */
  it.each([
    [0, "1fr 1fr"],
    [4, "1fr 1fr"],
    [5, "repeat(3, minmax(150px, 1fr))"],
    [7, "repeat(3, minmax(150px, 1fr))"],
    [10, "repeat(4, minmax(150px, 1fr))"],
  ])("with %i live session(s) hands lg the row template %s", (count, template) => {
    const grid = renderGrid({ working: Array.from({ length: count }, (_, i) => live(i)) });

    expect(customProperty(grid, "--desk-working-rows")).toBe(template);
    expect(
      hasVariant(grid, "lg", "grid-rows-(--desk-working-rows)"),
      "the desktop grid no longer reads its row template",
    ).toBe(true);
  });

  /**
   * Below lg the rows are implicit and floored by their content: a phone's
   * single column has as many rows as cells, and none of them may be shorter
   * than the tile or card it holds. `1fr` on top of the floor keeps the two
   * tiles sharing the band when the desk has room to spare, exactly as the
   * desktop frame does.
   */
  it("floors every row below lg by the content it holds", () => {
    const grid = renderGrid({ working: [live(0)] });

    expect(
      tokens(grid).some((token) => /^max-lg:auto-rows-\[minmax\(min-content,/.test(token)),
      "the phone's rows have no content floor, so a 60px row crushes a 92px tile",
    ).toBe(true);
  });
});
