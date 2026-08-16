"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Hammer,
  Search,
  GitMerge,
  MessageSquare,
  Sparkles,
  FileText,
  StopCircle,
  ChevronUp,
  ChevronDown,
  Clock,
  Layers,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatElapsed } from "@/lib/utils/format-elapsed";
import { usePolling } from "@/hooks/usePolling";
import type { UnifiedActivity } from "@/hooks/useAgentPolling";

/** Subset of DagBatchSnapshot the wave indicator renders. */
interface WaveBatchIndicator {
  batchId: string;
  currentWave: number;
  totalWaves: number;
}

interface AgentMonitorProps {
  projectId: string;
  activities: UnifiedActivity[];
  highlightedActivityId?: string | null;
}

function providerLabel(provider: string): string {
  if (provider === "gemini-cli") return "Gemini";
  if (provider === "codex") return "Codex";
  return "CC";
}

/**
 * Whole minutes since the session last produced output. Rendered in the
 * stalled tooltip; recomputed on every elapsed tick, so it stays current.
 */
function minutesSince(lastActivityAt: string, now: Date): number {
  const last = Date.parse(lastActivityAt);
  if (Number.isNaN(last)) return 0;
  return Math.max(0, Math.floor((now.getTime() - last) / 60_000));
}

const typeIcons: Record<UnifiedActivity["type"], typeof Hammer> = {
  build: Hammer,
  review: Search,
  merge: GitMerge,
  chat: MessageSquare,
  spec_generation: Sparkles,
  release: FileText,
};

export function AgentMonitor({
  projectId,
  activities,
  highlightedActivityId = null,
}: AgentMonitorProps) {
  const [expanded, setExpanded] = useState(true);
  const [elapsed, setElapsed] = useState<Record<string, string>>({});
  const [waveBatches, setWaveBatches] = useState<WaveBatchIndicator[]>([]);

  // Active DAG batch builds ("Build by waves") — the registry only lists
  // running batches, so an empty array simply hides the indicator.
  const pollWaves = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/build/waves`);
      const json = await res.json();
      setWaveBatches(Array.isArray(json.data) ? json.data : []);
    } catch {
      // ignore — indicator is best-effort
    }
  }, [projectId]);
  usePolling(pollWaves, 3000, activities.length > 0);

  useEffect(() => {
    if (activities.length === 0) return;

    function updateElapsed() {
      const now = new Date();
      const newElapsed: Record<string, string> = {};
      for (const a of activities) {
        if (a.startedAt) {
          newElapsed[a.id] = formatElapsed(a.startedAt, now);
        }
      }
      setElapsed(newElapsed);
    }

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);
    return () => clearInterval(interval);
  }, [activities]);

  if (activities.length === 0) return null;

  async function handleCancel(activityId: string) {
    await fetch(`/api/projects/${projectId}/sessions/${activityId}`, {
      method: "DELETE",
    });
  }

  // Running agents first; queued ones wait below them, mirroring the
  // scheduler's actual order of execution.
  const runningActivities = activities.filter((a) => a.status !== "queued");
  const queuedActivities = activities.filter((a) => a.status === "queued");
  const orderedActivities = [...runningActivities, ...queuedActivities];

  return (
    <div className="border-t border-border bg-muted/30">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-1.5 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        <span className="font-medium">
          {runningActivities.length} active agent
          {runningActivities.length !== 1 ? "s" : ""}
          {queuedActivities.length > 0 && ` · ${queuedActivities.length} queued`}
        </span>
        {waveBatches.map((batch) => (
          <span
            key={batch.batchId}
            data-testid={`agent-monitor-wave-${batch.batchId}`}
            className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-sky-500 shrink-0"
            title="DAG batch build: dependency waves run in order"
          >
            <Layers className="h-3 w-3" />
            Wave {Math.max(batch.currentWave, 1)}/{batch.totalWaves}
          </span>
        ))}
        {expanded ? (
          <ChevronDown className="h-3 w-3 ml-auto" />
        ) : (
          <ChevronUp className="h-3 w-3 ml-auto" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-2 space-y-1">
          {orderedActivities.map((activity) => {
            const isQueued = activity.status === "queued";
            const Icon = isQueued
              ? Clock
              : typeIcons[activity.type] || Loader2;
            const isHighlighted = activity.id === highlightedActivityId;
            const isStale = !isQueued && !!activity.stale;
            const staleTooltip = activity.lastActivityAt
              ? `No output for ${minutesSince(activity.lastActivityAt, new Date())}m`
              : "No output";
            return (
              <div
                key={activity.id}
                data-testid={`agent-monitor-activity-${activity.id}`}
                className={`flex items-center gap-2 text-xs py-1 px-1 rounded-sm transition-colors ${
                  isHighlighted ? "bg-primary/10 ring-1 ring-primary/40" : ""
                } ${isQueued ? "opacity-70" : ""}`}
              >
                <Icon
                  className={`h-3 w-3 shrink-0 ${
                    isQueued || isStale ? "text-amber-500" : "text-green-500"
                  }`}
                />
                <span className="truncate">{activity.label}</span>
                <span className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide shrink-0">
                  {activity.namedAgentName || providerLabel(activity.provider)}
                </span>
                {isQueued ? (
                  <span className="text-amber-500 text-[10px] font-medium uppercase tracking-wide shrink-0">
                    queued
                  </span>
                ) : (
                  <>
                    {isStale && (
                      <span
                        data-testid={`agent-monitor-stalled-${activity.id}`}
                        className="text-amber-500 text-[10px] font-medium uppercase tracking-wide shrink-0"
                        title={staleTooltip}
                      >
                        stalled
                      </span>
                    )}
                    <span className="text-muted-foreground font-mono shrink-0">
                      {elapsed[activity.id] || "0s"}
                    </span>
                  </>
                )}
                {activity.cancellable && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-5 w-5 ml-auto shrink-0 hover:text-destructive ${
                      isStale ? "text-amber-500" : "text-muted-foreground"
                    }`}
                    onClick={() => handleCancel(activity.id)}
                    title={isStale ? "Stop session" : "Cancel"}
                  >
                    <StopCircle className="h-3 w-3" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
