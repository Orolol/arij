import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/arij-project";

/**
 * B-arij-HZofmlKjLzmM — the WORKING band on a phone, in a real browser.
 *
 * This is the half of the fix that `__tests__/desk-working-band-mobile.test.tsx`
 * cannot do. jsdom has no layout engine, so the unit file only pins the
 * markup that produced the defect. How many columns the grid resolves to, how
 * wide each one is, whether the TODAY footer is clamped and whether a live
 * card's log line is still inside the card are visual claims and need Chrome.
 *
 * WHAT THIS SPEC MEASURED BEFORE THE FIX (2026-09-07, Chrome via
 * `channel: "chrome"`, run against the merge-base `WorkingBand.tsx` with the
 * fixture below): at 390×844 the grid resolved to THREE column tracks of
 * 101.3px on "/" and 86.7px on `/projects/:id`, with the two tiles in 57.3px
 * rows. At 1280 and 1440 it resolved to three columns of 398px / 451.3px and
 * two rows of 77.4px — the frame the fix leaves alone. Every threshold below
 * is chosen against those readings.
 *
 * THE DESK PAYLOAD IS STUBBED. `GET /api/control-desk` is fulfilled from a
 * fixture so the session count is exactly 0, 1 or 4 — the e2e database is
 * shared and `fullyParallel`, and no real aggregate could be pinned to a
 * number, let alone to a live session that would need a running agent. This
 * spec performs no mutation, so no id in the fixture has to exist; the
 * project row does, because `/projects/:id` refuses to render without one.
 */

/** The two widths the ticket names, with the column count each must resolve to. */
const MOBILE_WIDTHS = [
  { width: 390, height: 844, columns: 1 },
  { width: 768, height: 1024, columns: 2 },
] as const;

/** The two the ticket protects: the three-column frame, unchanged. */
const DESKTOP_WIDTHS = [
  { width: 1280, height: 900 },
  { width: 1440, height: 900 },
] as const;

/**
 * Below 300px a 326px phone column would have lost its content padding to
 * something else; on the unfixed band every cell measured 101.3px at 390.
 */
const MIN_MOBILE_CELL_WIDTH = 300;

/**
 * `/projects/:id` mounts the same desk inside `UnifiedChatPanel`, whose
 * collapsed rail is `w-[44px]` — so every band there is 44px narrower than on
 * "/", and a phone column measures 282px. That is the host's gutter, not the
 * grid's doing: the relative claim (one column = the whole band) is asserted
 * unchanged, and only the absolute floor moves by the rail.
 */
const CHAT_RAIL_WIDTH = 44;

interface DeskSeed {
  projectId: string;
  projectName: string;
}

/** A live session; the odd ones carry the NIGHT and STALLED tags, the widest header. */
function liveSession(seed: DeskSeed, index: number) {
  return {
    sessionId: `live-${index}`,
    projectId: seed.projectId,
    epicId: `epic-live-${index}`,
    readableId: `F-arij-${120 + index}`,
    title: "Now mobile : la bande WORKING garde 3 colonnes à 390 px, les tuiles écrasées",
    taskType: index % 2 === 0 ? "BUILD" : "REVIEW",
    agentName: "Opus Builder",
    startedAt: new Date(Date.now() - 252_000 - index * 60_000).toISOString(),
    lastLogLine: "editing components/desk/WorkingBand.tsx (+18 −6) — running vitest",
    nightRun: index % 2 === 1,
    stale: index % 2 === 1,
  };
}

/**
 * The stubbed desk payload.
 *
 * `signals` decides whether the desk column overflows the viewport. With six
 * coral rows it does at both mobile widths, and WORKING sits on the 190px
 * floor `NowDesk` gives it below lg — the tightest box the band ever gets,
 * which is why it is the default here. With none, the column has room to
 * spare and the band grows into it.
 */
function deskPayload(seed: DeskSeed, sessions: number, signals: 0 | 6) {
  const asks = signals === 6 ? 2 : 0;
  const failed = signals === 6 ? 3 : 0;
  const conflicts = signals === 6 ? 1 : 0;
  return {
    generatedAt: new Date().toISOString(),
    projects: [
      {
        id: seed.projectId,
        name: seed.projectName,
        shortName: "ARIJ",
        colorIndex: 0,
        activeAgents: sessions,
        autoModeEnabled: false,
      },
    ],
    working: Array.from({ length: sessions }, (_, i) => liveSession(seed, i)),
    queued: [0, 1].map((i) => ({
      sessionId: `queued-${i}`,
      projectId: seed.projectId,
      epicId: `epic-queued-${i}`,
      readableId: `F-arij-${900 + i}`,
      title: "Inline review findings in the ticket overlay",
    })),
    today: { ticketsShipped: 3, failedSessions: 1, costUsd: 1.42, projects: 2, sessions: 9 },
    yourTurn: {
      awaitingReply: Array.from({ length: asks }, (_, i) => ({
        epicId: `epic-ask-${i}`,
        projectId: seed.projectId,
        readableId: `F-arij-${100 + i}`,
        title: "Refonte du renderer legacy",
        question:
          "Je garde le renderer legacy derrière un flag de configuration, ou je le supprime maintenant ?",
        author: "agent",
        askedAt: "2026-09-06T09:00:00",
        unreadAi: true,
      })),
      failed: Array.from({ length: failed }, (_, i) => ({
        epicId: `epic-failed-${i}`,
        projectId: seed.projectId,
        readableId: `B-arij-${200 + i}`,
        title: "Worker pool",
        sessionId: `failed-session-${i}`,
        error: "exit 1 — worker pool did not drain in 120s",
        agentType: "build",
        agentName: "Opus Builder",
        provider: "claude-code",
        namedAgentId: null,
        userStoryId: null,
        producedOutput: true,
        failedAt: "2026-09-06T08:40:00",
      })),
      conflicts: Array.from({ length: conflicts }, (_, i) => ({
        epicId: `epic-conflict-${i}`,
        projectId: seed.projectId,
        readableId: `F-arij-${300 + i}`,
        title: "Tax export",
        blocker: "merge_conflict" as const,
        branchName: "feature/epic-tax-export",
        at: "2026-09-06T08:00:00",
      })),
    },
    readyToLand:
      signals === 6
        ? [0, 1].map((i) => ({
            epicId: `epic-land-${i}`,
            projectId: seed.projectId,
            readableId: `F-arij-${400 + i}`,
            title: "Introduire des plafonds de rétention sur le chemin d'écriture",
            prNumber: 218 + i,
            usDone: 4,
            usCount: 4,
            openFindings: 0,
            agentBusy: false,
          }))
        : [],
    heldBackCount: signals === 6 ? 1 : 0,
    upNext:
      signals === 6
        ? [
            {
              projectId: seed.projectId,
              tickets: Array.from({ length: 5 }, (_, i) => ({
                epicId: `epic-next-${i}`,
                projectId: seed.projectId,
                readableId: `F-arij-${500 + i}`,
                title: "Mobile : actions Your turn hors écran et tickets Up next illisibles",
                status: "todo",
                rank: i + 1,
                blockedBy: [] as string[],
                awaitingReply: false,
                specOnly: false,
                storyCount: 3,
              })),
            },
          ]
        : [],
  };
}

/**
 * Serves the fixture for `GET /api/control-desk` and nothing else.
 *
 * The desk polls every 4s, so this stays installed for the whole navigation:
 * a one-shot fulfil would be replaced by the real (empty) aggregate a few
 * seconds in, and every assertion after that would be about a blank band.
 */
async function stubDesk(page: Page, seed: DeskSeed, sessions: number, signals: 0 | 6) {
  await page.unroute("**/api/control-desk").catch(() => {});
  await page.route("**/api/control-desk", (route) =>
    route.fulfill({ json: { data: deskPayload(seed, sessions, signals) } }),
  );
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

interface CellReading extends Box {
  testId: string | null;
  /** Content height against box height: `scrollHeight > clientHeight` is content painted outside the cell. */
  scrollHeight: number;
  clientHeight: number;
}

interface LineReading extends Box {
  text: string;
  /** `scrollWidth > clientWidth` is a clamped (ellipsised) line. */
  clientWidth: number;
  scrollWidth: number;
}

interface CardReading extends Box {
  title: Box | null;
  stop: Box | null;
  log: LineReading | null;
  chrono: Box | null;
}

interface GridReading {
  band: Box;
  grid: Box & { scrollHeight: number; clientHeight: number };
  /** Resolved track widths, from the computed `grid-template-columns`. */
  columnTracks: number[];
  /** Resolved track heights, from the computed `grid-template-rows` (explicit tracks only). */
  rowTracks: number[];
  cells: CellReading[];
  /** Distinct left edges among the cells — the column count the layout actually produced. */
  columns: number;
  todayFooter: LineReading | null;
  queuedKicker: LineReading | null;
  queuedTitles: LineReading[];
  cards: CardReading[];
}

/** Everything the assertions need, read in one pass so every number is from the same frame. */
async function readGrid(page: Page): Promise<GridReading> {
  return page.evaluate(() => {
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
    const line = (el: Element | null | undefined): LineReading | null =>
      el
        ? {
            ...box(el),
            text: (el.textContent ?? "").trim(),
            clientWidth: (el as HTMLElement).clientWidth,
            scrollWidth: (el as HTMLElement).scrollWidth,
          }
        : null;
    const tracks = (value: string): number[] =>
      value
        .split(" ")
        .map((token) => Number.parseFloat(token))
        .filter((n) => Number.isFinite(n))
        .map((n) => +n.toFixed(1));

    const grid = document.querySelector('[data-testid="desk-working-grid"]') as HTMLElement;
    const band = grid.closest('[data-stratum="live"]') as HTMLElement;
    const computed = getComputedStyle(grid);
    const cells = [...grid.children].map((cell) => ({
      testId: cell.getAttribute("data-testid"),
      ...box(cell),
      scrollHeight: (cell as HTMLElement).scrollHeight,
      clientHeight: (cell as HTMLElement).clientHeight,
    }));

    const today = grid.querySelector('[data-testid="desk-today-tile"]');
    const todayFooter = today?.querySelector(':scope > [data-slot="mono"]');
    const queued = grid.querySelector('[data-testid="desk-queued-tile"]');
    const cards = [...grid.querySelectorAll('[data-testid="desk-live-session"]')].map((card) => {
      const title = card.querySelector("button.line-clamp-2");
      const stop = card.querySelector('[data-testid="desk-stop-session"]');
      const log = [...card.querySelectorAll('[data-slot="mono"]')].find((el) =>
        (el.textContent ?? "").startsWith("›"),
      );
      const chrono = card.querySelector('[data-slot="chrono"]');
      return {
        ...box(card),
        title: title ? box(title) : null,
        stop: stop ? box(stop) : null,
        log: line(log),
        chrono: chrono ? box(chrono) : null,
      };
    });

    return {
      band: box(band),
      grid: { ...box(grid), scrollHeight: grid.scrollHeight, clientHeight: grid.clientHeight },
      columnTracks: tracks(computed.gridTemplateColumns),
      rowTracks: tracks(computed.gridTemplateRows),
      cells,
      columns: new Set(cells.map((cell) => Math.round(cell.x))).size,
      todayFooter: line(todayFooter),
      queuedKicker: line(queued?.querySelector('[data-slot="field-kicker"]')),
      // A queued row is an identity chip (itself a span) followed by the
      // title span, so the title is the row's last child.
      queuedTitles: [...(queued?.querySelectorAll("button") ?? [])].map(
        (row) => line(row.lastElementChild) as LineReading,
      ),
      cards,
    };
  });
}

/** `inner` lies inside `outer`, to half a pixel. */
function within(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - 0.5 &&
    inner.right <= outer.right + 0.5 &&
    inner.y >= outer.y - 0.5 &&
    inner.bottom <= outer.bottom + 0.5
  );
}

/**
 * The mobile claims, at one width: every cell is a legible column, nothing
 * is clamped, nothing spills out of its box.
 */
function expectLegibleMobileGrid(
  reading: GridReading,
  where: string,
  columns: number,
  sessions: number,
  minCellWidth = MIN_MOBILE_CELL_WIDTH,
) {
  // 1. The column count the layout produced, twice over: the resolved tracks
  //    and the cells' own left edges. Three columns of 98.7px was the defect.
  expect(
    reading.columnTracks.length,
    `${where}: the grid resolves to ${reading.columnTracks.length} column track(s) ` +
      `(${reading.columnTracks.join(" / ")}px)`,
  ).toBe(columns);
  expect(reading.columns, `${where}: the cells sit on ${reading.columns} distinct left edge(s)`).toBe(
    columns,
  );
  // Each column is its full share of the band — one column is the whole
  // grid, two are the grid less one gap, split evenly — and wide enough to
  // read whatever the host's gutters.
  const share = +((reading.grid.width - (columns - 1) * 11) / columns).toFixed(1);
  for (const track of reading.columnTracks) {
    expect(
      Math.abs(track - share),
      `${where}: a column track is ${track}px, not the band's share of ${share}px`,
    ).toBeLessThan(1);
    expect(track, `${where}: a column track is only ${track}px wide`).toBeGreaterThan(
      minCellWidth,
    );
  }

  // 2. Every cell — live cards and both tiles — is present, wide, inside the
  //    grid's width, and holds its content.
  expect(reading.cells.map((cell) => cell.testId)).toEqual([
    ...Array.from({ length: sessions }, () => "desk-live-session"),
    "desk-queued-tile",
    "desk-today-tile",
  ]);
  for (const cell of reading.cells) {
    expect(cell.width, `${where}: ${cell.testId} is ${cell.width}px wide`).toBeGreaterThan(
      minCellWidth,
    );
    expect(cell.right, `${where}: ${cell.testId} runs past the grid`).toBeLessThanOrEqual(
      reading.grid.right + 0.5,
    );
    expect(
      cell.scrollHeight,
      `${where}: ${cell.testId} paints ${cell.scrollHeight}px of content in a ${cell.clientHeight}px box`,
    ).toBeLessThanOrEqual(cell.clientHeight + 1);
  }

  // 3. The TODAY footer — the line the ticket saw disappear — is one
  //    unclamped line inside its tile.
  const today = reading.cells.find((cell) => cell.testId === "desk-today-tile")!;
  expect(reading.todayFooter, `${where}: no TODAY footer`).not.toBeNull();
  expect(reading.todayFooter!.text).toBe("$1.42 · 2 projects · 9 sessions");
  expect(
    reading.todayFooter!.scrollWidth,
    `${where}: the TODAY footer is clamped — ${reading.todayFooter!.scrollWidth}px of line in ` +
      `${reading.todayFooter!.clientWidth}px of box`,
  ).toBeLessThanOrEqual(reading.todayFooter!.clientWidth);
  expect(within(reading.todayFooter!, today), `${where}: the TODAY footer is painted outside its tile`).toBe(
    true,
  );

  // 4. The QUEUED kicker on one line (it broke into "QUEUED ·" / "2"), and
  //    each queued row showing its title rather than a sliver.
  expect(reading.queuedKicker, `${where}: no QUEUED kicker`).not.toBeNull();
  expect(reading.queuedKicker!.text).toBe("QUEUED · 2");
  expect(
    reading.queuedKicker!.height,
    `${where}: the QUEUED kicker is ${reading.queuedKicker!.height}px tall — two lines`,
  ).toBeLessThan(22);
  expect(reading.queuedTitles).toHaveLength(2);
  for (const title of reading.queuedTitles) {
    expect(
      title.clientWidth,
      `${where}: a queued title has ${title.clientWidth}px for "${title.text}"`,
    ).toBeGreaterThan(150);
  }

  // 5. Each live card: a readable title, the stop control inside the card,
  //    the chrono present, and the log line inside the card rather than
  //    overflowing it.
  expect(reading.cards).toHaveLength(sessions);
  for (const [index, card] of reading.cards.entries()) {
    const label = `${where}: live card ${index}`;
    expect(card.title, `${label} has no title`).not.toBeNull();
    expect(card.title!.width, `${label}: the title is ${card.title!.width}px wide`).toBeGreaterThan(
      200,
    );
    expect(card.stop, `${label} has no stop control`).not.toBeNull();
    expect(within(card.stop!, card), `${label}: the stop control is outside the card`).toBe(true);
    expect(card.chrono, `${label} has no chrono`).not.toBeNull();
    expect(card.log, `${label} has no log line`).not.toBeNull();
    expect(within(card.log!, card), `${label}: the log line is painted outside the card`).toBe(true);
  }
}

/**
 * Navigates and waits for THIS payload, not for the band.
 *
 * `NowDesk` renders the two tiles with em-dashes before its first poll
 * answers, so "the TODAY tile is visible" is true of an empty desk too and a
 * reading taken then measures the wrong grid. The footer figures and the live
 * cards exist only in the stub.
 */
async function openDesk(page: Page, url: string, sessions: number) {
  await page.goto(url);
  await expect(page.getByTestId("now-desk")).toBeVisible();
  await expect(page.getByTestId("desk-today-tile")).toContainText("9 sessions");
  await expect(page.getByTestId("desk-live-session")).toHaveCount(sessions);
}

test.describe("the WORKING band on a phone", () => {
  /**
   * The ticket's own pass condition: measured at 390 and 768 with at least
   * one live session in the payload, and the column width pinned rather than
   * the class list. Zero sessions is the tile-only case the ticket's own
   * capture was taken in; four is a busy morning.
   */
  test("resolves to one column at 390 and two at 768, each wide enough to read", async ({
    page,
    project,
  }) => {
    const seed = { projectId: project.id, projectName: project.name };

    for (const { width, height, columns } of MOBILE_WIDTHS) {
      for (const sessions of [0, 1, 4] as const) {
        await stubDesk(page, seed, sessions, 6);
        await page.setViewportSize({ width, height });
        await openDesk(page, "/", sessions);
        const where = `${width}×${height} · ${sessions} session(s)`;

        // No page-level sideways scroll. Necessary, nowhere near sufficient:
        // the unfixed grid already held this, its three columns just shrank.
        const doc = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(
          doc.scrollWidth,
          `${where}: the page scrolls sideways (${doc.scrollWidth} > ${doc.clientWidth})`,
        ).toBeLessThanOrEqual(doc.clientWidth);

        const reading = await readGrid(page);
        console.log(
          `[working-band] ${where}: band ${reading.band.width}×${reading.band.height}, ` +
            `grid ${reading.grid.width}×${reading.grid.height} ` +
            `(content ${reading.grid.scrollHeight}px), columns ${reading.columnTracks.join("/")}px, ` +
            `rows ${reading.rowTracks.join("/")}px, cells ` +
            reading.cells.map((c) => `${c.testId?.replace("desk-", "")} ${c.width}×${c.height}`).join(", "),
        );
        expectLegibleMobileGrid(reading, where, columns, sessions);

        // The two tiles are the LAST cells, and with a live session ahead of
        // them on a phone they sit past the band's own fold. Past, not lost:
        // the grid scrolls, and each tile can be brought into the viewport.
        for (const testId of ["desk-queued-tile", "desk-today-tile"] as const) {
          await page.getByTestId(testId).scrollIntoViewIfNeeded();
          await expect(page.getByTestId(testId), `${where}: ${testId} cannot be reached`).toBeInViewport();
        }
      }
    }
  });

  /**
   * With room to spare the two tiles share the band, as they do on the
   * desktop frame: the phone's rows are floored by their content, not fixed
   * to it, so an empty desk does not leave a coloured void under a 38px tile.
   */
  test("lets the two tiles share the band when the desk has room to spare", async ({
    page,
    project,
  }) => {
    const seed = { projectId: project.id, projectName: project.name };
    await stubDesk(page, seed, 0, 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await openDesk(page, "/", 0);

    const reading = await readGrid(page);
    console.log(
      `[working-band] 390×844 · 0 signal: band ${reading.band.height}px, grid ${reading.grid.height}px, ` +
        `cells ${reading.cells.map((c) => `${c.height}`).join("/")}px`,
    );
    expectLegibleMobileGrid(reading, "390×844 · 0 signal", 1, 0);

    const [queued, today] = reading.cells;
    expect(
      reading.grid.scrollHeight,
      "the band scrolls although the column had room for both tiles",
    ).toBeLessThanOrEqual(reading.grid.clientHeight + 1);
    expect(
      Math.abs(queued.height - today.height),
      `the tiles do not share the band: QUEUED ${queued.height}px, TODAY ${today.height}px`,
    ).toBeLessThan(1);
    expect(queued.height, "the tiles were not given the band's spare height").toBeGreaterThan(120);
  });

  /**
   * `/projects/:id` renders the SAME `NowDesk`, so the grid is shared by
   * construction — but its band is not the same: the project desk fills the
   * header's right slot with the wave chips, and its host clips rather than
   * scrolls. One pass at 390 with a live session answers for the host.
   */
  test("carries the single column onto a project desk", async ({ page, project }) => {
    const seed = { projectId: project.id, projectName: project.name };
    await stubDesk(page, seed, 1, 6);
    await page.setViewportSize({ width: 390, height: 844 });
    await openDesk(page, project.boardUrl, 1);

    const reading = await readGrid(page);
    console.log(
      `[working-band] ${project.boardUrl} @ 390×844 · 1 session: band ${reading.band.width}px, ` +
        `grid ${reading.grid.width}px, columns ${reading.columnTracks.join("/")}px`,
    );
    expectLegibleMobileGrid(
      reading,
      `${project.boardUrl} @ 390×844 · 1 session`,
      1,
      1,
      MIN_MOBILE_CELL_WIDTH - CHAT_RAIL_WIDTH,
    );
    await page.getByTestId("desk-today-tile").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("desk-today-tile")).toBeInViewport();
  });

  /**
   * The other half of the ticket: the desktop frame is unchanged. Three equal
   * columns, and — up to six cells — exactly two equal rows sharing the band,
   * the "1fr 1fr" the band has always drawn. Geometry rather than classes:
   * the fix moves the row template into a custom property that only the `lg`
   * variant reads, and a variant that failed to apply would leave the class
   * names intact and the frame gone.
   */
  test("leaves the desktop frame at three columns and two rows", async ({ page, project }) => {
    const seed = { projectId: project.id, projectName: project.name };

    for (const { width, height } of DESKTOP_WIDTHS) {
      for (const sessions of [1, 4] as const) {
        await stubDesk(page, seed, sessions, 6);
        await page.setViewportSize({ width, height });
        await openDesk(page, "/", sessions);
        const where = `${width}×${height} · ${sessions} session(s)`;

        const reading = await readGrid(page);
        console.log(
          `[working-band] ${where}: grid ${reading.grid.width}×${reading.grid.height}, ` +
            `columns ${reading.columnTracks.join("/")}px, rows ${reading.rowTracks.join("/")}px`,
        );

        expect(reading.columnTracks, `${where}: not three columns`).toHaveLength(3);
        expect(reading.columns).toBe(3);
        const expected = +((reading.grid.width - 2 * 11) / 3).toFixed(1);
        for (const track of reading.columnTracks) {
          expect(
            Math.abs(track - expected),
            `${where}: a column is ${track}px, not a third of the grid (${expected}px)`,
          ).toBeLessThan(1);
        }

        // Up to six cells the frame is two rows splitting the grid's height.
        expect(reading.rowTracks, `${where}: not two explicit rows`).toHaveLength(2);
        expect(
          Math.abs(reading.rowTracks[0] - reading.rowTracks[1]),
          `${where}: the two rows are unequal (${reading.rowTracks.join(" / ")}px)`,
        ).toBeLessThan(1);
        expect(
          Math.abs(reading.rowTracks[0] + reading.rowTracks[1] + 11 - reading.grid.height),
          `${where}: the two rows do not fill the grid`,
        ).toBeLessThan(1);

        // And nothing scrolls: six cells is the frame.
        expect(reading.grid.scrollHeight).toBeLessThanOrEqual(reading.grid.clientHeight + 1);
        for (const cell of reading.cells) {
          expect(within(cell, reading.grid), `${where}: ${cell.testId} is outside the grid`).toBe(true);
        }
      }
    }
  });
});
