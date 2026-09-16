"use client";

/**
 * PIPELINE — the white card at the top of the right rail (frame 6a, 275-286).
 *
 * "Pipeline" is the one label in the overlay that is plain ink with no
 * underline: it sits on a white card, not a stratum ground, so it does not go
 * through `BandHeader`.
 *
 * The chain's 2px pending rings and connectors are the design's sanctioned
 * exception to the 1.5px border rule — at a 20px marker, 1.5px does not read.
 * `PipelineChain` owns that; nothing here restyles it.
 *
 * Under the chain, two read-outs the column alone cannot give:
 * - the ticket's latest pipeline run from the registry (stage, attempt,
 *   fix cycle, and the runner's reason once it ended badly), in words;
 * - its rank in its own column, with the manual moves. Ordering is a
 *   button press here or a Refinement pass — never a drag. The words name
 *   the column on purpose: UP NEXT numbers a different list (In Progress
 *   ahead of To Do, blocked and waiting tickets skipped), so "#1 in To Do"
 *   can be UP NEXT's fourth, and a move past a blocked neighbour changes
 *   this rank without changing UP NEXT's.
 */

import { ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, type LucideIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Mono, PillButton, PipelineChain, SurfaceCard, type PipelineStep } from "@/components/piscine";
import type { PipelineRunCounter, PipelineRunLine } from "@/components/ticket/derive";
import { StatusControl } from "@/components/ticket/StatusControl";
import type { TicketQueueMove, TicketQueuePlacement } from "@/hooks/useTicketQueuePosition";
import { formatRelative } from "@/lib/i18n/format";
import type { UiLocale } from "@/lib/i18n/locales";
import { PIPELINE_STAGE_LABEL_KEYS } from "@/lib/pipeline/constants";
import { COLUMN_LABEL_KEYS, type KanbanStatus } from "@/lib/types/kanban";

/** Full catalogue paths so the key gate sees every state word as referenced. */
const RUN_STATE_KEYS = {
  running: "Ticket.pipeline.run.running",
  succeeded: "Ticket.pipeline.run.succeeded",
  failed: "Ticket.pipeline.run.failed",
  paused_question: "Ticket.pipeline.run.paused_question",
  cancelled: "Ticket.pipeline.run.cancelled",
} as const satisfies Record<PipelineRunLine["state"], string>;

interface QueueMoveButton {
  move: TicketQueueMove;
  icon: LucideIcon;
  labelKey:
    | "Ticket.pipeline.queue.top"
    | "Ticket.pipeline.queue.up"
    | "Ticket.pipeline.queue.down"
    | "Ticket.pipeline.queue.bottom";
  /** true for the moves that go toward rank 1. */
  towardTop: boolean;
}

const QUEUE_MOVES: readonly QueueMoveButton[] = [
  { move: "top", icon: ChevronsUp, labelKey: "Ticket.pipeline.queue.top", towardTop: true },
  { move: "up", icon: ChevronUp, labelKey: "Ticket.pipeline.queue.up", towardTop: true },
  { move: "down", icon: ChevronDown, labelKey: "Ticket.pipeline.queue.down", towardTop: false },
  { move: "bottom", icon: ChevronsDown, labelKey: "Ticket.pipeline.queue.bottom", towardTop: false },
];

export interface PipelineCardProps {
  steps: PipelineStep[];
  status: string;
  priority: number;
  hasRunningSession: boolean;
  statusError: string | null;
  onStatusChange: (next: string) => void;
  onPriorityChange: (next: number) => void;
  /** The ticket's latest registry run; null keeps the column derivation alone. */
  run?: PipelineRunLine | null;
  /** Rank in the column; null (unknown, or another column's) hides the control. */
  queue?: TicketQueuePlacement | null;
  queueMoving?: boolean;
  queueError?: string | null;
  onQueueMove?: (move: TicketQueueMove) => void;
}

export function PipelineCard({
  steps,
  status,
  priority,
  hasRunningSession,
  statusError,
  onStatusChange,
  onPriorityChange,
  run = null,
  queue = null,
  queueMoving = false,
  queueError = null,
  onQueueMove,
}: PipelineCardProps) {
  const t = useTranslations("Ticket");
  const tKey = useTranslations();
  const locale = useLocale() as UiLocale;

  const counter = (
    value: PipelineRunCounter,
    bounded: "Ticket.pipeline.run.attempt" | "Ticket.pipeline.run.fixCycles",
    open: "Ticket.pipeline.run.attemptOpen" | "Ticket.pipeline.run.fixCyclesOpen",
  ) =>
    value.max === null
      ? tKey(open, { count: value.count })
      : tKey(bounded, { count: value.count, max: value.max });

  let runWords: string | null = null;
  if (run) {
    const parts = [
      run.state === "running"
        ? tKey(RUN_STATE_KEYS.running, {
            stage: run.stage ? tKey(PIPELINE_STAGE_LABEL_KEYS[run.stage]) : "—",
          })
        : tKey(RUN_STATE_KEYS[run.state]),
    ];
    // A finished run stays in the registry's ring until a restart: its age
    // keeps "Last run failed" from reading as the ticket's present state.
    const age = run.endedAt ? formatRelative(run.endedAt, { locale }) : "";
    if (age) parts.push(age);
    if (run.story) parts.push(tKey("Ticket.pipeline.run.story", { title: run.story }));
    if (run.attempt) {
      parts.push(counter(run.attempt, "Ticket.pipeline.run.attempt", "Ticket.pipeline.run.attemptOpen"));
    }
    if (run.fixCycles) {
      parts.push(counter(run.fixCycles, "Ticket.pipeline.run.fixCycles", "Ticket.pipeline.run.fixCyclesOpen"));
    }
    runWords = parts.join(" · ");
  }

  const showQueue = queue !== null && queue.movable;

  return (
    <SurfaceCard
      radius={12}
      className="flex shrink-0 flex-col gap-[9px] px-4 py-[13px]"
      data-testid="ticket-pipeline"
    >
      <div className="flex items-baseline gap-[10px]">
        <span className="font-display text-[12px] font-bold uppercase tracking-[.1em] text-foreground">
          {t("pipeline.label")}
        </span>
        <StatusControl
          status={status}
          priority={priority}
          hasRunningSession={hasRunningSession}
          onStatusChange={onStatusChange}
          onPriorityChange={onPriorityChange}
        />
      </div>

      <PipelineChain steps={steps} orientation="horizontal" markerSize={20} />

      {run && runWords ? (
        <div className="flex flex-col gap-[2px]">
          <p
            data-testid="ticket-pipeline-run"
            className="m-0 text-[12px] leading-[1.5] text-foreground"
          >
            {runWords}
          </p>
          {run.reason ? (
            <p
              data-testid="ticket-pipeline-run-reason"
              className="m-0 text-[12px] leading-[1.5] text-muted-foreground"
            >
              {run.reason}
            </p>
          ) : null}
        </div>
      ) : null}

      {showQueue ? (
        <div data-testid="ticket-queue" className="flex flex-wrap items-center gap-2">
          {/* While a move is in flight the rank it would replace is stale:
              the word says so, the buttons wait. */}
          <Mono size={12} tone="muted" className="mr-auto">
            {queueMoving
              ? t("pipeline.queue.moving")
              : t("pipeline.queue.rank", {
                  rank: queue.rank,
                  total: queue.total,
                  column: COLUMN_LABEL_KEYS[queue.status as KanbanStatus]
                    ? tKey(COLUMN_LABEL_KEYS[queue.status as KanbanStatus])
                    : queue.status,
                })}
          </Mono>
          <span className="flex items-center gap-1">
            {QUEUE_MOVES.map(({ move, icon, labelKey, towardTop }) => {
              const atEdge = towardTop ? queue.rank <= 1 : queue.rank >= queue.total;
              return (
                <PillButton
                  key={move}
                  variant="outline"
                  outlineTone="neutral"
                  iconOnly
                  icon={icon}
                  title={tKey(labelKey)}
                  disabled={atEdge || queueMoving || !onQueueMove}
                  onClick={() => onQueueMove?.(move)}
                >
                  {tKey(labelKey)}
                </PillButton>
              );
            })}
          </span>
        </div>
      ) : null}

      {showQueue && queueError ? (
        <p
          data-testid="ticket-queue-error"
          className="m-0 text-[12px] leading-[1.5] text-destructive"
        >
          {queueError}
        </p>
      ) : null}

      {/* The workflow engine is the source of truth; its rejection lands
          here, next to the control that produced it. */}
      {statusError ? (
        <p
          data-testid="ticket-status-error"
          className="m-0 text-[12px] leading-[1.5] text-destructive"
        >
          {statusError}
        </p>
      ) : null}
    </SurfaceCard>
  );
}
