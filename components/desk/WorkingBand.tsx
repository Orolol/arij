"use client";

import type * as React from "react";
import { useTranslations } from "next-intl";

import { BandHeader, StrataBand } from "@/components/piscine";
import type {
  DeskProject,
  DeskQueuedSession,
  DeskToday,
  DeskWorkingSession,
} from "@/lib/control-desk/types";
import { cn } from "@/lib/utils";

import { LiveSessionCard } from "./LiveSessionCard";
import { WaveRunChips } from "./WaveRunChips";
import { QueuedTile } from "./QueuedTile";
import { TodayTile } from "./TodayTile";

/**
 * WORKING — the turquoise stratum, and the ONLY band on the desk that grows.
 *
 * Everything else is `flex: 0 0 auto` and sizes to its content, which is what
 * makes "an empty stratum collapses to its label line" literally true.
 *
 * UNDRAWN STATES, defined here:
 * - 0 live sessions → the grid has no session rows, so it shrinks to the two
 *   tiles and the band folds to roughly a header plus one tile row. The tiles
 *   stay: "queued: 0" and the day's roll-up are still the answer to "what is
 *   happening", and dropping them would leave a coloured empty rectangle.
 * - >4 live sessions → the grid adds rows and the band scrolls
 *   (`overflow-y:auto` + `min-h-0`), with QUEUED and TODAY pinned as the last
 *   two cells so they never scroll out of reach.
 *
 * THE NIGHT-RUN HEADER LINE IS ABSENT ON "/" ON PURPOSE. It needs a wave
 * concept: night runs are per-project and live in an in-process registry (lost
 * on restart), and no durable row aggregates them ACROSS projects. The
 * documented fallback is to omit the right slot rather than fabricate one, and
 * the cross-project desk still does exactly that.
 *
 * A PROJECT desk is the case that decision could not cover: there, one
 * `projectId` names one registry, and `WaveRunChips` fills the right slot with
 * the wave counter, the night-run marker and "Stop night run" — the three
 * things that had no home but the pre-redesign `AgentMonitor` bar.
 */
/** The column count of the desktop frame — the only one with an explicit row template. */
const DESKTOP_COLUMNS = 3;

export interface WorkingBandProps {
  working: readonly DeskWorkingSession[];
  queued: readonly DeskQueuedSession[];
  today: DeskToday;
  projectsById: ReadonlyMap<string, DeskProject>;
  onOpenTicket?: (epicId: string) => void;
  onStopSession?: (sessionId: string) => void;
  /** Set on a project desk; omit on "/" — see the note above. */
  projectId?: string;
  className?: string;
}

export function WorkingBand({
  working,
  queued,
  today,
  projectsById,
  onOpenTicket,
  onStopSession,
  projectId,
  className,
}: WorkingBandProps) {
  const t = useTranslations("Desk");
  const meta = t("working.meta", { agents: working.length, queued: queued.length });
  // The two tiles are always the last two cells.
  const cellCount = working.length + 2;
  // The desktop frame's row template, computed for the three columns `lg`
  // draws. It is handed to the grid as a custom property that ONLY the `lg`
  // variant reads (see the class list below), so the phone's one column and
  // the tablet's two never inherit a row count that assumed three.
  const rowCount = Math.max(2, Math.ceil(cellCount / DESKTOP_COLUMNS));
  const desktopRows =
    cellCount <= 6 ? "1fr 1fr" : `repeat(${rowCount}, minmax(150px, 1fr))`;

  return (
    <StrataBand
      stratum="live"
      density="full"
      gap={12}
      grow
      className={cn("mx-[14px] mt-0", className)}
    >
      <BandHeader
        label={t("working.label")}
        stratum="live"
        labelSize={13}
        meta={meta}
        right={
          projectId ? (
            <WaveRunChips projectId={projectId} />
          ) : undefined
        }
      />

      <div
        data-testid="desk-working-grid"
        style={{ "--desk-working-rows": desktopRows } as React.CSSProperties}
        className={cn(
          "grid min-h-0 flex-1 gap-[11px] overflow-y-auto",
          /*
            ONE COLUMN ON A PHONE, TWO FROM `sm`, THREE FROM `lg` —
            B-arij-HZofmlKjLzmM.

            The grid was `grid-cols-3` at every width. On a 390px phone the
            band is 326px wide, so each column measured 98.7px: the TODAY
            footer (`$1.42 · 2 projets · 9 sessions`, 201px of line) was
            clamped to "$1.42 ·", the QUEUED kicker broke onto two lines and
            a live card's log line was painted outside the card. Two columns
            of 346px at 768 hold a card; one column of 326px at 390 does too.
            Same ladder as `components/qa/QaRunsBand.tsx`.
          */
          "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
          /*
            ROWS. From `lg` up, 3 columns × 2 rows is the frame: past six cells
            the grid grows rows of at least 150px and the band scrolls, so a
            busy morning never squeezes four cards into an unreadable strip.
            That template only makes sense for three columns, so it applies
            only where three columns do.

            Below `lg` the rows are implicit, and each is floored by the
            content it holds: the old "1fr 1fr" split a 130px box into two
            60px rows and painted a 92px tile's footer outside it. `1fr` on
            top of the floor keeps the tiles sharing the band when the desk
            has room to spare, exactly as the desktop frame does.
          */
          "lg:grid-rows-(--desk-working-rows)",
          "max-lg:auto-rows-[minmax(min-content,1fr)]",
        )}
      >
        {working.map((session) => (
          <LiveSessionCard
            key={session.sessionId}
            session={session}
            project={projectsById.get(session.projectId)}
            onOpenTicket={onOpenTicket}
            onStop={onStopSession}
          />
        ))}
        <QueuedTile
          queued={queued}
          projectsById={projectsById}
          onOpenTicket={onOpenTicket}
        />
        <TodayTile today={today} />
      </div>
    </StrataBand>
  );
}
