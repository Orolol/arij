"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Circle,
  CircleCheck,
  CircleHelp,
  Loader2,
  LoaderCircle,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { stopNightRun, useNightRunDetail } from "@/hooks/useNightRuns";
import {
  NIGHT_RUN_STATUS_LABELS,
  formatNightRunCost,
  formatNightRunCounts,
  formatNightRunDuration,
  nightRunAbortKind,
  nightRunAbortSentence,
} from "@/components/night/night-run-format";
import type { TicketExecutionStatus } from "@/lib/dependencies/scheduler";

interface NightRunSummaryDialogProps {
  projectId: string;
  /** Run to show; null keeps the dialog closed. */
  runId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Outcome colour per execution status — tokens only. */
const STATUS_CLASSES: Record<TicketExecutionStatus, string> = {
  done: "text-agent",
  asked: "text-primary",
  failed: "text-destructive",
  skipped: "text-meta",
  running: "text-agent",
  pending: "text-meta",
};

const STATUS_ICONS: Record<TicketExecutionStatus, LucideIcon> = {
  done: CircleCheck,
  asked: CircleHelp,
  failed: TriangleAlert,
  skipped: TriangleAlert,
  running: LoaderCircle,
  pending: Circle,
};

/** The four buckets the morning read is about, in headline order. */
const SUMMARY_TILES: TicketExecutionStatus[] = [
  "done",
  "asked",
  "failed",
  "skipped",
];

/**
 * The morning read of an overnight run: what landed in Review, what asked a
 * question, what failed (with a link to the ticket where the forensic
 * diagnostic was posted), what never started, and what it cost.
 */
export function NightRunSummaryDialog({
  projectId,
  runId,
  open,
  onOpenChange,
}: NightRunSummaryDialogProps) {
  const { detail, loading, error, refresh } = useNightRunDetail(
    projectId,
    open ? runId : null
  );
  const [stopping, setStopping] = useState(false);

  const cost = detail
    ? formatNightRunCost(detail.totalCostUsd, detail.costIsPartial)
    : null;
  const duration = detail
    ? formatNightRunDuration(detail.startedAt, detail.endedAt)
    : null;
  const abortKind = nightRunAbortKind(detail?.abortReason);
  const abortSentence = nightRunAbortSentence(
    detail?.abortReason,
    detail?.abortedAtWave
  );
  const running = detail?.state === "running" && !detail.interrupted;
  // The server flag survives a dialog remount; the local one covers the gap
  // between the click and the next poll.
  const stopPending = stopping || detail?.stopRequested === true;

  async function handleStop() {
    if (!runId) return;
    setStopping(true);
    await stopNightRun(projectId, runId);
    await refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden rounded-[14px] border bg-card p-0 shadow-[0_18px_40px_rgba(58,48,44,.14)] sm:max-w-[560px]"
      >
        <DialogHeader className="flex-row items-center gap-[10px] space-y-0 border-b border-border-soft px-[24px] py-[20px] text-left">
          <DialogTitle className="shrink-0 text-[16px] font-semibold leading-none">
            Night run
          </DialogTitle>
          <span className="min-w-0 truncate font-mono text-[11.5px] text-meta">
            {runId}
            {detail && (
              <>
                {" · "}
                <span data-testid="night-summary-duration">{duration}</span>
                {" · "}
                <span data-testid="night-summary-cost">
                  {cost ?? "cost not reported"}
                </span>
              </>
            )}
          </span>
          {detail?.state === "running" && (
            <span className="shrink-0 text-[11.5px] text-agent">running</span>
          )}
          {running && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto h-[27px] shrink-0 gap-1 rounded-[8px] text-[12.5px]"
              data-testid="night-run-stop-button"
              disabled={stopPending}
              onClick={handleStop}
              title="Stop launching new epics. Epics already running finish their pipeline."
            >
              <Square className="h-3 w-3" />
              {stopPending ? "Stopping…" : "Stop night run"}
            </Button>
          )}
          <DialogClose
            className={cn(
              "shrink-0 rounded-[6px] text-meta transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              !running && "ml-auto"
            )}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>

        {/* The outcome sentence stays the accessible description of the
            dialog; the tiles below are its visual form. */}
        <DialogDescription className="sr-only" data-testid="night-summary-counts">
          {detail
            ? formatNightRunCounts(detail.counts)
            : loading
              ? "Loading…"
              : "No data for this run."}
        </DialogDescription>

        <div className="flex flex-col gap-[20px] px-[24px] py-[22px]">
          {loading && !detail && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading summary…
            </div>
          )}

          {error && !detail && (
            <p
              className="text-[13px] text-destructive"
              data-testid="night-summary-error"
            >
              {error}
            </p>
          )}

          {detail && (
            <>
              <div className="flex gap-[10px]">
                {SUMMARY_TILES.map((status) => (
                  <div
                    key={status}
                    className="flex flex-1 flex-col gap-[3px] rounded-[11px] bg-band p-[14px]"
                  >
                    <span
                      className={cn(
                        "text-[22px] font-semibold leading-none",
                        STATUS_CLASSES[status]
                      )}
                    >
                      {detail.counts?.[status] ?? 0}
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      {NIGHT_RUN_STATUS_LABELS[status]}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-meta">
                {detail.totalWaves != null && (
                  <span data-testid="night-summary-waves">
                    Wave {Math.max(detail.currentWave ?? 0, 1)}/
                    {detail.totalWaves}
                  </span>
                )}
                {detail.failurePolicy && (
                  <span>
                    On failure:{" "}
                    {detail.failurePolicy === "stop" ? "stop" : "halt"}
                  </span>
                )}
                {detail.costIsPartial && (
                  <span data-testid="night-summary-cost-caveat">
                    Some sessions reported no cost (only Claude Code returns
                    one), so the total is a lower bound.
                  </span>
                )}
              </div>

              {stopPending && !detail.abortReason && (
                <div
                  data-testid="night-summary-stopping"
                  className="rounded-[11px] border border-border-soft bg-band p-[12px] text-[12px] text-muted-foreground"
                >
                  Stopping — no new epic will be launched. The wave currently
                  running is left to finish its pipelines.
                </div>
              )}

              {detail.abortReason && abortSentence && (
                <div
                  data-testid="night-summary-abort"
                  data-abort-kind={abortKind ?? "other"}
                  className={cn(
                    "flex gap-2 rounded-[11px] border p-[12px] text-[12px] leading-[1.55]",
                    abortKind === "stopped"
                      ? "border-border-soft bg-band text-muted-foreground"
                      : "border-priority-yellow/40 bg-priority-yellow/10 text-muted-foreground"
                  )}
                >
                  {abortKind === "stopped" ? (
                    <Square className="h-4 w-4 shrink-0" />
                  ) : (
                    <TriangleAlert className="h-4 w-4 shrink-0 text-priority-yellow" />
                  )}
                  <span>{abortSentence}</span>
                </div>
              )}

              {detail.interrupted && (
                <div
                  data-testid="night-summary-interrupted"
                  className="rounded-[11px] border border-border-soft bg-band p-[12px] text-[12px] text-muted-foreground"
                >
                  Interrupted by a server restart — partial data. Sessions that
                  were still running were marked orphaned at boot.
                </div>
              )}

              <div className="flex max-h-[320px] flex-col overflow-y-auto">
                {detail.epics.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground">
                    No epics were dispatched by this run.
                  </p>
                ) : (
                  detail.epics.map((epic) => {
                    const Icon = STATUS_ICONS[epic.status] ?? Circle;
                    const subline = [
                      epic.readableId || epic.epicId,
                      NIGHT_RUN_STATUS_LABELS[epic.status] ?? epic.status,
                      epic.reason,
                      epic.costUsd != null && epic.costUsd > 0
                        ? `$${epic.costUsd.toFixed(2)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <div
                        key={epic.epicId}
                        data-testid={`night-epic-${epic.epicId}`}
                        className="flex items-start gap-[11px] border-t border-border-soft py-[12px] first:border-t-0"
                      >
                        <Icon
                          className={cn(
                            "mt-[1px] h-[15px] w-[15px] shrink-0",
                            STATUS_CLASSES[epic.status]
                          )}
                        />
                        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
                          <Link
                            href={`/projects/${projectId}?ticket=${epic.epicId}`}
                            className="truncate text-[13.5px] font-medium hover:text-primary"
                          >
                            {epic.title || epic.readableId || epic.epicId}
                          </Link>
                          <span className="truncate font-mono text-[11px] text-meta">
                            {subline}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>

        {detail && (
          <DialogFooter className="gap-[10px] px-[24px] pb-[22px] sm:justify-end">
            <Button
              asChild
              variant="outline"
              className="h-[31px] rounded-[8px] px-[12px] text-[13px]"
            >
              <Link href={`/projects/${projectId}/sessions`}>Open sessions</Link>
            </Button>
            <Button
              asChild
              className="h-[31px] rounded-[8px] px-[13px] text-[13px] font-medium"
            >
              <Link href={`/projects/${projectId}`}>Review on the board</Link>
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
