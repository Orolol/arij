"use client";

import { useState } from "react";
import { Loader2, Moon, Square, TriangleAlert } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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

const STATUS_CLASSES: Record<TicketExecutionStatus, string> = {
  done: "text-green-500",
  asked: "text-amber-500",
  failed: "text-red-500",
  skipped: "text-muted-foreground",
  running: "text-sky-500",
  pending: "text-muted-foreground",
};

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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Moon className="h-4 w-4" />
            Night run
            {detail?.state === "running" && (
              <span className="text-xs font-normal text-sky-500">running</span>
            )}
            {running && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto h-7 gap-1 text-xs"
                data-testid="night-run-stop-button"
                disabled={stopPending}
                onClick={handleStop}
                title="Stop launching new epics. Epics already running finish their pipeline."
              >
                <Square className="h-3 w-3" />
                {stopPending ? "Stopping…" : "Stop night run"}
              </Button>
            )}
          </DialogTitle>
          <DialogDescription>
            {detail
              ? formatNightRunCounts(detail.counts)
              : loading
                ? "Loading…"
                : "No data for this run."}
          </DialogDescription>
        </DialogHeader>

        {loading && !detail && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading summary…
          </div>
        )}

        {error && !detail && (
          <p className="text-sm text-destructive" data-testid="night-summary-error">
            {error}
          </p>
        )}

        {detail && (
          <div className="space-y-4">
            <p
              className="text-base font-medium"
              data-testid="night-summary-counts"
            >
              {formatNightRunCounts(detail.counts)}
            </p>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span data-testid="night-summary-duration">
                Duration {formatNightRunDuration(detail.startedAt, detail.endedAt)}
              </span>
              {detail.totalWaves != null && (
                <span data-testid="night-summary-waves">
                  Wave {Math.max(detail.currentWave ?? 0, 1)}/{detail.totalWaves}
                </span>
              )}
              <span data-testid="night-summary-cost">
                Cost {cost ?? "not reported"}
              </span>
              {detail.failurePolicy && (
                <span>
                  On failure: {detail.failurePolicy === "stop" ? "stop" : "halt"}
                </span>
              )}
            </div>

            {detail.costIsPartial && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="night-summary-cost-caveat"
              >
                Some sessions reported no cost (only Claude Code returns one),
                so the total is a lower bound.
              </p>
            )}

            {stopPending && !detail.abortReason && (
              <div
                data-testid="night-summary-stopping"
                className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground"
              >
                Stopping — no new epic will be launched. The wave currently
                running is left to finish its pipelines.
              </div>
            )}

            {detail.abortReason && abortSentence && (
              <div
                data-testid="night-summary-abort"
                data-abort-kind={abortKind ?? "other"}
                className={`flex gap-2 rounded-md border p-2 text-xs ${
                  abortKind === "stopped"
                    ? "border-border bg-muted/40 text-muted-foreground"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                }`}
              >
                {abortKind === "stopped" ? (
                  <Square className="h-4 w-4 shrink-0" />
                ) : (
                  <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" />
                )}
                <span>{abortSentence}</span>
              </div>
            )}

            {detail.interrupted && (
              <div
                data-testid="night-summary-interrupted"
                className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground"
              >
                Interrupted by a server restart — partial data. Sessions that
                were still running were marked orphaned at boot.
              </div>
            )}

            <div className="space-y-1 max-h-80 overflow-y-auto">
              {detail.epics.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No epics were dispatched by this run.
                </p>
              ) : (
                detail.epics.map((epic) => (
                  <div
                    key={epic.epicId}
                    data-testid={`night-epic-${epic.epicId}`}
                    className="flex items-start gap-2 rounded-sm border border-border/60 px-2 py-1.5 text-xs"
                  >
                    <span
                      className={`font-medium uppercase tracking-wide shrink-0 ${
                        STATUS_CLASSES[epic.status] ?? ""
                      }`}
                    >
                      {NIGHT_RUN_STATUS_LABELS[epic.status] ?? epic.status}
                    </span>
                    <a
                      href={`/projects/${projectId}?ticket=${epic.epicId}`}
                      className="underline decoration-dotted truncate"
                    >
                      {epic.readableId
                        ? `${epic.readableId} · ${epic.title ?? ""}`.trim()
                        : (epic.title ?? epic.epicId)}
                    </a>
                    {epic.reason && (
                      <span className="text-muted-foreground truncate">
                        {epic.reason}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 font-mono text-muted-foreground">
                      {epic.costUsd != null && epic.costUsd > 0
                        ? `$${epic.costUsd.toFixed(2)}`
                        : ""}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
