"use client";

import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useCockpit } from "@/hooks/useCockpit";
import { formatNightRunCost } from "@/components/night/night-run-format";

/**
 * Ambient project band: what ran overnight, what is running now, what is
 * waiting on the user, and what the last 24h produced. Always mounted on the
 * board route — an empty cockpit still says something, so every cell has an
 * honest empty state rather than disappearing.
 */
export function CockpitBar({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { nightRun, runningSessions, awaitingReply, yesterday, loading } =
    useCockpit(projectId);

  const nightIsLive =
    nightRun !== null && nightRun.state === "running" && !nightRun.interrupted;

  const liveNightParts: string[] = [];
  if (nightRun) {
    if (nightRun.currentWave !== null && nightRun.totalWaves !== null) {
      liveNightParts.push(`Wave ${nightRun.currentWave}/${nightRun.totalWaves}`);
    }
    if (nightRun.totalEpics > 0) {
      liveNightParts.push(`${nightRun.totalEpics} epics`);
    }
    const cost = formatNightRunCost(nightRun.totalCostUsd, nightRun.costIsPartial);
    if (cost) liveNightParts.push(cost);
  }

  const visibleAgents = runningSessions.slice(0, 2);
  const hiddenAgents = runningSessions.length - visibleAgents.length;
  const firstAwaiting = awaitingReply[0];

  return (
    <div
      className="h-[72px] shrink-0 flex bg-band border-b border-border"
      data-testid="cockpit-bar"
    >
      <Cell
        label="NIGHT RUN"
        testId="cockpit-night-run"
        className="flex-[1] border-r border-border"
      >
        {loading ? (
          <span className="text-meta">—</span>
        ) : nightIsLive ? (
          <span className="flex items-center gap-[9px] min-w-0">
            <span className="breathing-dot w-2 h-2 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {liveNightParts.length > 0 ? liveNightParts.join(" · ") : "Running"}
            </span>
          </span>
        ) : nightRun ? (
          <button
            type="button"
            data-testid="night-last-run-button"
            onClick={() =>
              router.push(`/projects/${projectId}?nightRun=${nightRun.runId}`)
            }
            className="text-left truncate hover:text-primary transition-colors"
          >
            {`Last night: ${nightRun.counts.done ?? 0} done · ${
              nightRun.counts.failed ?? 0
            } failed`}
          </button>
        ) : (
          <span className="text-meta">No night runs yet</span>
        )}
      </Cell>

      <Cell
        label="AGENTS WORKING"
        testId="cockpit-agents"
        className="flex-[1.2] border-r border-border"
      >
        {runningSessions.length === 0 ? (
          <span className="text-meta">None right now</span>
        ) : (
          <span className="truncate">
            {visibleAgents.map((a) => a.label).join(" · ")}
            {hiddenAgents > 0 ? ` · +${hiddenAgents} more` : ""}
          </span>
        )}
      </Cell>

      <Cell
        label="AWAITING MY REPLY"
        testId="cockpit-awaiting"
        className="flex-[1] border-r border-border"
      >
        {firstAwaiting ? (
          <button
            type="button"
            data-testid="cockpit-awaiting-link"
            onClick={() =>
              router.push(`/projects/${projectId}?ticket=${firstAwaiting.epicId}`)
            }
            className="text-left truncate"
          >
            {`${awaitingReply.length} question${
              awaitingReply.length === 1 ? "" : "s"
            }`}
            {firstAwaiting.readableId ? (
              <>
                {" · "}
                <span className="text-primary">{firstAwaiting.readableId}</span>
              </>
            ) : null}
          </button>
        ) : (
          <span className="text-meta">All clear</span>
        )}
      </Cell>

      <Cell label="YESTERDAY" testId="cockpit-yesterday" className="w-[220px] shrink-0">
        <span className="truncate">
          {`${yesterday.completed} done · ${yesterday.failed} failed`}
        </span>
      </Cell>
    </div>
  );
}

function Cell({
  label,
  testId,
  className,
  children,
}: {
  label: string;
  testId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-col justify-center gap-[5px] px-[22px] min-w-0",
        className
      )}
    >
      <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
        {label}
      </span>
      <div className="text-[13.5px] min-w-0">{children}</div>
    </div>
  );
}
