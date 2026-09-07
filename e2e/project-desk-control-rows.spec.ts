import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/arij-project";

/**
 * B-arij-jcJeNQZnT1X9 — the two control rows above the project desk, on a
 * phone, in a real browser.
 *
 * This is the half of the fix that
 * `__tests__/project-desk-control-rows-mobile.test.tsx` cannot do. jsdom has
 * no layout engine, so the unit file only pins the markup that produced the
 * defect. Whether a button is inside the viewport, whether a tap reaches it,
 * and whether the hint is drawn whole or as "⌘-…" are visual claims and need
 * Chrome.
 *
 * THE TWO ROWS. `/projects/:id` draws, above `<NowDesk>`:
 *
 *   - `project-action-row` (the layout): New · Night run · Sync from
 *     arji.json — full viewport width less the 14px gutters;
 *   - `board-capture-bar` (the page): Full Auto · Agent Refinement · the
 *     ⌘-click hint — INSIDE the chat panel's slot, so beside the collapsed
 *     chat strip it has the viewport less 45px, less its own 22px gutters:
 *     ~301px of content at 390, ~231px at 320.
 *
 * WHAT WAS MEASURED HERE BEFORE THE FIX (2026-09-07, Chrome via
 * `channel: "chrome"`, the numbers are in the spec's own failure messages and
 * in the ticket's closing comment): at 390×844 the hint measured 22px wide for
 * a 232px label ("⌘-…") and Agent Refinement ended flush with the bar's
 * content edge; with Full Auto armed (badge "2 building · 1 reviewing") Agent
 * Refinement lay entirely past the bar, unreachable by any tap. The action row
 * fitted at every width, and is folded only so a fourth control cannot
 * reproduce the same defect one row up.
 *
 * THE STATUS READS ARE STUBBED, NOTHING ELSE IS. Full Auto's badge and the
 * refinement pass's "running" badge are the widest the two buttons ever draw,
 * and arming the real supervisor from a spec would dispatch real sessions.
 * `GET …/auto-mode` and `GET …/refinement` are therefore fulfilled from
 * fixtures in the "busy" sweep; every other request, the project itself and
 * the desk payload included, is real.
 */

/** The widths the ticket names (390) and the ones around it. */
const MOBILE_WIDTHS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
] as const;

const DESKTOP_WIDTHS = [
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
] as const;

/** A tolerance for a shared fractional edge, not for a real overlap. */
const EDGE = 0.5;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

interface ControlGeometry extends Box {
  row: "action" | "capture";
  label: string;
  /** Horizontally outside the viewport, in whole or in part. */
  outside: boolean;
  /** Share of 15 sample points along the control's midline that hit-test to
   *  something else — a clipped or covered control cannot be tapped there. */
  missPercent: number;
}

interface RowsGeometry {
  scrollWidth: number;
  clientWidth: number;
  action: Box | null;
  capture: Box | null;
  controls: ControlGeometry[];
  hint: (Box & { clientWidth: number; scrollWidth: number }) | null;
}

/**
 * Both rows, every button in them, and the hint — measured.
 *
 * HORIZONTAL, deliberately, for the viewport test: the rows sit at the top of
 * the page and are never legitimately below the fold. The hit-test is the
 * stronger claim and covers both axes: a control clipped by an
 * `overflow-hidden` host is inside the viewport and still unreachable.
 */
async function readRows(page: Page, viewportWidth: number): Promise<RowsGeometry> {
  return page.evaluate((vw) => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return {
        x: +r.x.toFixed(1),
        y: +r.y.toFixed(1),
        width: +r.width.toFixed(1),
        height: +r.height.toFixed(1),
        right: +r.right.toFixed(1),
        bottom: +r.bottom.toFixed(1),
      };
    };
    const SAMPLES = 15;
    const missPercent = (el: Element): number => {
      const r = el.getBoundingClientRect();
      const y = r.y + r.height / 2;
      let miss = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const x = Math.min(r.x + (r.width * i) / (SAMPLES - 1), r.right - 0.5);
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(el === hit || el.contains(hit))) miss++;
      }
      return (miss / SAMPLES) * 100;
    };
    const controlsOf = (row: "action" | "capture", root: Element | null): ControlGeometry[] =>
      root
        ? [...root.querySelectorAll("button")].map((el) => {
            const b = box(el);
            return {
              row,
              label: (el.textContent || el.getAttribute("aria-label") || "?").trim().slice(0, 40),
              ...b,
              outside: b.x < -0.5 || b.right > vw + 0.5,
              missPercent: missPercent(el),
            };
          })
        : [];

    const action = document.querySelector('[data-testid="project-action-row"]');
    const capture = document.querySelector('[data-testid="board-capture-bar"]');
    // By test id once the fix names it; by shape (the bar's one span child)
    // before, so the unfixed bar still yields numbers rather than "no hint".
    const hint = (document.querySelector('[data-testid="board-capture-hint"]') ??
      capture?.querySelector(":scope > span") ??
      null) as HTMLElement | null;

    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      action: action ? box(action) : null,
      capture: capture ? box(capture) : null,
      controls: [...controlsOf("action", action), ...controlsOf("capture", capture)],
      hint: hint
        ? { ...box(hint), clientWidth: hint.clientWidth, scrollWidth: hint.scrollWidth }
        : null,
    };
  }, viewportWidth);
}

/**
 * The widest the two buttons ever draw: Full Auto armed with in-flight
 * counts, a refinement pass running. Reads only — a PUT/POST goes through.
 */
async function stubBusyStatuses(page: Page) {
  await page.route("**/api/projects/*/auto-mode", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      json: {
        data: {
          enabled: true,
          buildAgent: null,
          buildConcurrency: 2,
          reviewAgent: null,
          reviewConcurrency: 1,
          smartDispatch: false,
          secondOpinion: false,
          effectiveSchedulerBudget: null,
          running: true,
          lastSweepAt: "2026-09-07T09:00:00.000Z",
          inFlight: { build: 2, review: 1 },
          candidates: { build: 3, review: 0, merge: 0 },
          parked: [],
          recentDispatches: [],
        },
      },
    });
  });
  await page.route("**/api/projects/*/refinement", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      json: { data: { running: true, sessionId: "e2e-refinement", ticketCount: 12 } },
    });
  });
}

/**
 * The board, hydrated: the desk has fetched its payload (the composer only
 * renders once it has), and both rows are on screen.
 */
async function openBoard(page: Page, boardUrl: string) {
  await page.goto(boardUrl);
  await expect(page.getByTestId("project-action-row")).toBeVisible();
  await expect(page.getByTestId("board-capture-bar")).toBeVisible();
  await expect(page.getByTestId("desk-composer-input")).toBeVisible();
}

/** The assertions every sweep shares, at one width. */
function expectRowsReachable(geometry: RowsGeometry, where: string) {
  // 1. No page-level sideways scroll. Necessary, nowhere near sufficient: the
  //    capture bar's hosts are `overflow-hidden`, so before the fix this held
  //    while Agent Refinement was cut off.
  expect(
    geometry.scrollWidth,
    `${where}: the page scrolls sideways (${geometry.scrollWidth} > ${geometry.clientWidth})`,
  ).toBeLessThanOrEqual(geometry.clientWidth);

  expect(geometry.action, `${where}: no action row`).not.toBeNull();
  expect(geometry.capture, `${where}: no capture bar`).not.toBeNull();

  // 2. Every button of both rows: rendered, inside the viewport, inside its
  //    own row's box, and reachable by a tap along its whole width.
  expect(geometry.controls.length, `${where}: no control rendered`).toBeGreaterThanOrEqual(4);
  const outside = geometry.controls.filter((c) => c.outside);
  expect(
    outside,
    `${where}: ${outside.length} control(s) outside the viewport: ` +
      outside.map((c) => `"${c.label}" x=${c.x}→${c.right}`).join(", "),
  ).toEqual([]);
  for (const control of geometry.controls) {
    const host = control.row === "action" ? geometry.action! : geometry.capture!;
    expect(control.width, `${where}: "${control.label}" has no width`).toBeGreaterThan(0);
    expect(
      control.right,
      `${where}: "${control.label}" ends at x=${control.right}, past its row's edge at ${host.right}`,
    ).toBeLessThanOrEqual(host.right + EDGE);
    expect(
      control.bottom,
      `${where}: "${control.label}" ends at y=${control.bottom}, below its row's edge at ${host.bottom}`,
    ).toBeLessThanOrEqual(host.bottom + EDGE);
    expect(
      control.missPercent,
      `${control.missPercent.toFixed(0)}% of "${control.label}" at ${where} is clipped or ` +
        `covered — a tap there does not reach it`,
    ).toBe(0);
  }

  // 3. The hint is drawn whole. It measured 22px for a 232px label before
  //    the fix ("⌘-…"); an ellipsis is `scrollWidth > clientWidth`.
  expect(geometry.hint, `${where}: no ⌘-click hint`).not.toBeNull();
  expect(
    geometry.hint!.scrollWidth,
    `${where}: the hint is truncated to ${geometry.hint!.clientWidth}px of ${geometry.hint!.scrollWidth}px`,
  ).toBeLessThanOrEqual(geometry.hint!.clientWidth + 1);
  expect(geometry.hint!.right, `${where}: the hint leaves its bar`).toBeLessThanOrEqual(
    geometry.capture!.right + EDGE,
  );
}

test.describe("the project desk's control rows on a phone", () => {
  test("keeps every control of both rows reachable at rest", async ({ page, project }) => {
    for (const { width, height } of MOBILE_WIDTHS) {
      await page.setViewportSize({ width, height });
      await openBoard(page, project.boardUrl);
      const where = `${width}×${height} · at rest`;

      const geometry = await readRows(page, width);
      expectRowsReachable(geometry, where);

      // The two dispatch controls the row exists for, by accessible name.
      await expect(page.getByRole("button", { name: /Full Auto/ })).toBeEnabled();
      await expect(page.getByRole("button", { name: /Agent Refinement/ })).toBeEnabled();
    }
  });

  /**
   * The widest the bar ever gets: with Full Auto armed the badge alone is
   * wider than the hint, and a running pass adds its own. Before the fix this
   * is the state in which Agent Refinement left the bar entirely.
   */
  test("keeps every control reachable with Full Auto armed and a pass running", async ({
    page,
    project,
  }) => {
    await stubBusyStatuses(page);

    for (const { width, height } of MOBILE_WIDTHS) {
      await page.setViewportSize({ width, height });
      await openBoard(page, project.boardUrl);
      // The stub has reached both buttons once their badges are up.
      await expect(page.getByTestId("auto-mode-toggle-badge")).toHaveText("2 building · 1 reviewing");
      await expect(page.getByTestId("refinement-button-badge")).toBeVisible();
      const where = `${width}×${height} · Full Auto armed, refinement running`;

      const geometry = await readRows(page, width);
      expectRowsReachable(geometry, where);
    }
  });

  /**
   * The other half of the ticket's contract: nothing changes on a desktop.
   * Both rows are one line — every control on the same baseline — and keep
   * the heights they have always had, 38px and 46px. Geometric facts rather
   * than class assertions, because the fix works by letting the rows wrap,
   * and a wrap that fired at 1280px would still carry the right class names.
   */
  test("leaves the desktop rows on one line at their original heights", async ({
    page,
    project,
  }) => {
    await stubBusyStatuses(page);

    for (const { width, height } of DESKTOP_WIDTHS) {
      await page.setViewportSize({ width, height });
      await openBoard(page, project.boardUrl);
      await expect(page.getByTestId("auto-mode-toggle-badge")).toBeVisible();
      const where = `${width}×${height}`;

      const geometry = await readRows(page, width);
      expectRowsReachable(geometry, where);

      expect(geometry.action!.height, `${where}: the action row is no longer 38px`).toBeCloseTo(38, 0);
      expect(geometry.capture!.height, `${where}: the capture bar is no longer 46px`).toBeCloseTo(46, 0);

      for (const row of ["action", "capture"] as const) {
        const tops = geometry.controls.filter((c) => c.row === row).map((c) => c.y);
        expect(
          Math.max(...tops) - Math.min(...tops),
          `${where}: the ${row} row's controls no longer share a line`,
        ).toBeLessThan(EDGE);
      }
      // The hint sits on the buttons' line, at the right edge.
      const [fullAuto] = geometry.controls.filter((c) => c.row === "capture");
      const buttonMid = fullAuto.y + fullAuto.height / 2;
      const hintMid = geometry.hint!.y + geometry.hint!.height / 2;
      expect(Math.abs(hintMid - buttonMid), `${where}: the hint dropped to its own line`).toBeLessThan(12);
      expect(geometry.hint!.x, `${where}: the hint is no longer pushed right`).toBeGreaterThan(
        fullAuto.right,
      );
    }
  });

  /**
   * The ticket's "neighbour never measured": `/` draws its own second row
   * (`desk-controls`, Project pages · Full Auto · N/M) in place of the two
   * project rows. Measured here, not fixed here — it fits at every width.
   *
   * The `project` fixture is what enables the Project pages pill: with no
   * project at all the trigger is `disabled`, and the pill recipe's
   * `disabled:pointer-events-none` makes a disabled pill hit-test to its
   * parent — which reads as "covered" and has nothing to do with layout.
   */
  test("measures the global desk's own control row", async ({ page, project }) => {
    expect(project.id).toBeTruthy();
    for (const { width, height } of MOBILE_WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await expect(page.getByTestId("desk-controls")).toBeVisible();
      // The desk payload has landed once the pill counts a project: before
      // that it reads "0/0", the Project pages trigger is disabled, and any
      // hit-test on it says nothing about the row.
      await expect(page.getByTestId("desk-full-auto")).toHaveText(/\/[1-9]\d*$/);
      await expect(page.getByTestId("desk-project-pages")).toBeEnabled();
      const where = `/ @ ${width}×${height}`;

      const controls = await page.evaluate((vw) => {
        const row = document.querySelector('[data-testid="desk-controls"]')!;
        const rowRect = row.getBoundingClientRect();
        return [...row.querySelectorAll("button")].map((el) => {
          const r = el.getBoundingClientRect();
          const y = r.y + r.height / 2;
          let miss = 0;
          for (let i = 0; i < 15; i++) {
            const x = Math.min(r.x + (r.width * i) / 14, r.right - 0.5);
            const hit = document.elementFromPoint(x, y);
            if (!hit || !(el === hit || el.contains(hit))) miss++;
          }
          return {
            label: (el.textContent || el.getAttribute("aria-label") || "?").trim().slice(0, 40),
            x: +r.x.toFixed(1),
            right: +r.right.toFixed(1),
            outside: r.x < -0.5 || r.right > vw + 0.5 || r.right > rowRect.right + 0.5,
            missPercent: (miss / 15) * 100,
          };
        });
      }, width);

      expect(controls.length, `${where}: no control in desk-controls`).toBeGreaterThanOrEqual(2);
      for (const control of controls) {
        expect(
          control.outside,
          `${where}: "${control.label}" x=${control.x}→${control.right} leaves the row or the viewport`,
        ).toBe(false);
        expect(
          control.missPercent,
          `${where}: ${control.missPercent.toFixed(0)}% of "${control.label}" is not tappable`,
        ).toBe(0);
      }
    }
  });
});
