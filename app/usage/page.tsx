"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PROVIDER_LABELS } from "@/lib/agent-config/constants";
import { useUsage } from "@/hooks/useUsage";
import { cn } from "@/lib/utils";
import { formatCostUsd, formatTokens } from "@/lib/utils/format-usage";
import type {
  SubscriptionStatus,
  SubscriptionWindowStatus,
  UsageReport,
  WindowUsage,
} from "@/lib/types/usage";

/**
 * Usage observatory.
 *
 * Two kinds of number live here and they are never blended:
 *  - provider-reported: rate-limit percentages codex itself emitted into
 *    ~/.codex/sessions, replayed verbatim with their capture time;
 *  - metered via Arij: sums over the sessions Arij launched. Claude exposes
 *    no account quota in headless mode, so this is a floor on real spend,
 *    never the account's remaining quota. Every claude surface says so.
 *
 * Absent data renders as an em-dash or an explicit empty state — never a
 * fabricated zero, never an invented bar.
 */
export default function UsagePage() {
  const { report, loading, error, refresh } = useUsage();

  if (loading && !report) {
    return (
      <div
        className="flex h-full min-h-0 flex-col gap-[14px] p-[22px]"
        data-testid="usage-loading"
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[120px] animate-pulse rounded-[11px] border border-border bg-card motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }

  if (error && !report) {
    return (
      <div
        className="flex h-full min-h-0 flex-col items-center justify-center gap-[12px] p-[22px]"
        data-testid="usage-error"
      >
        <p className="text-[13px] text-muted-foreground">{error}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SynthesisBand report={report} />

      <div className="flex shrink-0 items-center justify-between border-b border-border px-[22px] py-[10px]">
        <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
          Usage observatory
        </span>
        <div className="flex items-center gap-[12px]">
          {error && (
            <span
              className="text-[11px] text-destructive"
              data-testid="usage-refresh-error"
            >
              {error}
            </span>
          )}
          <span className="font-mono text-[11px] text-meta">
            Updated {formatClock(report.generatedAt)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void refresh()}
            disabled={loading}
            data-testid="usage-refresh"
          >
            <RotateCw className="h-[14px] w-[14px]" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-[28px]">
        <div
          className="flex flex-wrap gap-[14px] px-[22px] pt-[18px]"
          data-testid="usage-subscriptions"
        >
          {report.subscriptions.map((sub) => (
            <SubscriptionCard
              key={sub.provider}
              sub={sub}
              nowMs={new Date(report.generatedAt).getTime()}
            />
          ))}
        </div>

        {report.totals.sessions === 0 ? (
          <div
            className="px-[22px] pt-[40px] text-center text-[13px] text-muted-foreground"
            data-testid="usage-empty"
          >
            No agent sessions recorded yet.
          </div>
        ) : (
          <>
            <DayStrip report={report} />
            <AgentTable report={report} />
            <ProjectList report={report} />
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Synthesis band                                                             */
/* -------------------------------------------------------------------------- */

function SynthesisBand({ report }: { report: UsageReport }) {
  const today = report.byDay[report.byDay.length - 1];

  return (
    <div
      data-testid="usage-band"
      className="flex h-[72px] shrink-0 border-b border-border bg-band"
    >
      <BandCell
        label="TODAY"
        testId="usage-band-today"
        value={
          today
            ? sessionsAndCost(today.sessions, today.costUsd, "No sessions today")
            : "No sessions today"
        }
      />
      <BandCell
        label="LAST 7 DAYS"
        testId="usage-band-7d"
        value={sessionsAndCost(
          report.windows.last7d.sessions,
          report.windows.last7d.costUsd,
          "No sessions"
        )}
      />
      <BandCell
        label="SESSIONS ALL TIME"
        testId="usage-band-total"
        value={String(report.totals.sessions)}
      />
      <BandCell
        label="TOTAL COST"
        testId="usage-band-cost"
        value={formatCostUsd(report.totals.costUsd) ?? "—"}
        valueClassName="font-mono"
        last
      />
    </div>
  );
}

/** Copied verbatim from app/projects/[projectId]/sessions/page.tsx (file-local there). */
function BandCell({
  label,
  value,
  testId,
  last = false,
  valueClassName,
}: {
  label: string;
  value: string;
  testId: string;
  last?: boolean;
  valueClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col justify-center gap-[5px] px-[22px]",
        !last && "border-r border-border"
      )}
    >
      <span className="text-[11.5px] tracking-[.08em] text-meta">{label}</span>
      <span
        data-testid={testId}
        className={cn("truncate text-[13.5px]", valueClassName)}
      >
        {value}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Subscription cards                                                         */
/* -------------------------------------------------------------------------- */

/**
 * `nowMs` is the report's own generation time, not a render-time clock read:
 * the card renders a snapshot as-of the fetch, stays pure across re-renders
 * (react-hooks/purity), and the next Refresh moves the anchor forward.
 */
function SubscriptionCard({
  sub,
  nowMs,
}: {
  sub: SubscriptionStatus;
  nowMs: number;
}) {
  return (
    <div
      className="w-[340px] max-w-full rounded-[11px] border border-border bg-card p-[16px]"
      data-testid={`usage-sub-${sub.provider}`}
    >
      <div className="flex items-center justify-between gap-[10px]">
        <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
          {providerLabel(sub.provider)}
        </span>
        <span
          className="rounded-full border border-border-soft px-[7px] py-[2px] text-[10.5px] uppercase tracking-[.08em] text-meta"
          data-testid={`usage-sub-${sub.provider}-source`}
        >
          {sub.source === "provider-reported"
            ? "Provider-reported"
            : "Metered via Arij"}
        </span>
      </div>

      {sub.plan && (
        <p className="mt-[6px] font-mono text-[11px] text-meta">
          plan: {sub.plan}
        </p>
      )}

      {sub.metered ? (
        <MeteredBody sub={sub} metered={sub.metered} />
      ) : (
        <ProviderReportedBody sub={sub} nowMs={nowMs} />
      )}
    </div>
  );
}

/** Codex: replayed rate-limit snapshot, or an honest "nothing recorded yet". */
function ProviderReportedBody({
  sub,
  nowMs,
}: {
  sub: SubscriptionStatus;
  nowMs: number;
}) {
  if (sub.capturedAt === null) {
    return (
      <p
        className="mt-[10px] text-[12.5px] text-muted-foreground"
        data-testid="usage-sub-codex-empty"
      >
        No provider snapshot found. Codex records rate-limit data when a
        session runs — none is recorded on this machine yet.
      </p>
    );
  }

  const ageMs = nowMs - new Date(sub.capturedAt).getTime();
  const stale = ageMs > 24 * 3600_000;

  return (
    <>
      <SnapshotWindow
        label={windowLabel(sub.primary?.windowMinutes ?? null)}
        snapshot={sub.primary}
        nowMs={nowMs}
        testId="usage-sub-codex-primary"
      />
      <SnapshotWindow
        label={windowLabel(sub.secondary?.windowMinutes ?? null)}
        snapshot={sub.secondary}
        nowMs={nowMs}
        testId="usage-sub-codex-secondary"
      />
      <p
        className={cn("mt-[12px] text-[11px]", stale ? "text-priority-yellow" : "text-meta")}
        data-testid="usage-sub-codex-captured"
      >
        Captured {formatRelativeAge(ageMs)} ago · ~/.codex/sessions
      </p>
    </>
  );
}

/**
 * Window label derived from what the provider actually emitted — never
 * asserted. Unknown window size gets the neutral "WINDOW".
 */
function windowLabel(windowMinutes: number | null): string {
  if (windowMinutes === null) return "WINDOW";
  if (windowMinutes === 10080) return "WEEKLY";
  if (windowMinutes % 1440 === 0) return `${windowMinutes / 1440}D WINDOW`;
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}H WINDOW`;
  return `${windowMinutes}MIN WINDOW`;
}

/**
 * One provider-reported window: the gauge plus its reset line. A reset time
 * already in the past is shown dimmed and called stale rather than silently
 * extrapolated forward — used_percent is never advanced past what codex said.
 */
function SnapshotWindow({
  label,
  snapshot,
  nowMs,
  testId,
}: {
  label: string;
  snapshot: SubscriptionWindowStatus | null;
  nowMs: number;
  testId: string;
}) {
  if (!snapshot) return null;

  const resetsAtMs = snapshot.resetsAt === null ? null : snapshot.resetsAt * 1000;
  const remainingMs = resetsAtMs === null ? null : resetsAtMs - nowMs;
  const expired = remainingMs !== null && remainingMs <= 0;

  return (
    <>
      <GaugeRow
        label={label}
        readout={
          snapshot.usedPercent === null
            ? "—"
            : `${Math.round(snapshot.usedPercent)}%`
        }
        percent={snapshot.usedPercent}
        dimmed={expired}
        testId={testId}
      />
      <p
        className="mt-[5px] font-mono text-[11px] text-meta"
        data-testid={`${testId}-reset`}
      >
        {remainingMs === null
          ? "reset time unknown"
          : expired
            ? "window expired — data stale"
            : `resets in ${formatCountdown(remainingMs)}`}
      </p>
    </>
  );
}

/** Claude: sums over Arij's own sessions, never presented as account quota. */
function MeteredBody({
  sub,
  metered,
}: {
  sub: SubscriptionStatus;
  metered: NonNullable<SubscriptionStatus["metered"]>;
}) {
  const budget = metered.budgetUsdWeek;
  const percent = metered.budgetUsedPercent;
  const over = percent !== null && percent > 100;

  return (
    <>
      <MeteredLine
        label="LAST 5H"
        usage={metered.last5h}
        testId={`usage-sub-${sub.provider}-5h`}
      />
      <MeteredLine
        label="LAST 7 DAYS"
        usage={metered.last7d}
        testId={`usage-sub-${sub.provider}-7d`}
      />

      {budget !== null && (
        <GaugeRow
          label="WEEKLY BUDGET"
          readout={`${formatCostUsd(metered.last7d.costUsd) ?? "—"} / ${
            formatCostUsd(budget) ?? "—"
          }`}
          percent={percent}
          readoutClassName={over ? "text-destructive" : undefined}
          testId="usage-sub-claude-budget"
        />
      )}

      <p
        className="mt-[12px] text-[11px] text-meta"
        data-testid="usage-sub-claude-disclaimer"
      >
        Sessions recorded by Arij only — not the account&apos;s full quota.
      </p>
    </>
  );
}

function MeteredLine({
  label,
  usage,
  testId,
}: {
  label: string;
  usage: WindowUsage;
  testId: string;
}) {
  const tokens =
    usage.inputTokens !== null && usage.outputTokens !== null
      ? formatTokens(usage.inputTokens + usage.outputTokens)
      : null;

  return (
    <div className="mt-[10px]">
      <span className="text-[10.5px] uppercase tracking-[.08em] text-meta">
        {label}
      </span>
      <p className="mt-[3px] font-mono text-[12.5px]" data-testid={testId}>
        {usage.sessions} session{usage.sessions === 1 ? "" : "s"} ·{" "}
        {tokens ?? "—"} tokens · {formatCostUsd(usage.costUsd) ?? "—"}
      </p>
    </div>
  );
}

/**
 * Determinate gauge. Deliberately inline-styled rather than `.progress-track`,
 * whose `.crawl-fill` is an indeterminate crawl animation. Fill width is
 * clamped to [0,100]; the readout is not, so a blown budget reads honestly.
 */
function GaugeRow({
  label,
  readout,
  percent,
  dimmed = false,
  readoutClassName,
  testId,
}: {
  label: string;
  readout: string;
  percent: number | null;
  dimmed?: boolean;
  readoutClassName?: string;
  testId: string;
}) {
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));

  return (
    <div className="mt-[12px]" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-[10px]">
        <span className="text-[10.5px] uppercase tracking-[.08em] text-meta">
          {label}
        </span>
        <span
          className={cn("font-mono text-[11px]", readoutClassName)}
          data-testid={`${testId}-readout`}
        >
          {readout}
        </span>
      </div>
      <div
        className="mt-[6px] h-[3px] w-full overflow-hidden rounded-full"
        style={{ background: "var(--agent-track)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${width}%`,
            background: "var(--agent)",
            opacity: dimmed ? 0.35 : 1,
          }}
          data-testid={`${testId}-fill`}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 30-day strip                                                               */
/* -------------------------------------------------------------------------- */

/**
 * CSS-only 30-day strip. Scales to cost when any cost is known, else to
 * session counts (codex sessions report no cost, so a cost-only scale would
 * flatten a genuinely busy month to nothing).
 */
function DayStrip({ report }: { report: UsageReport }) {
  const days = report.byDay;
  const maxCost = days.reduce((max, d) => Math.max(max, d.costUsd ?? 0), 0);
  const useCost = maxCost > 0;
  const scaleMax = useCost
    ? maxCost
    : days.reduce((max, d) => Math.max(max, d.sessions), 0);

  return (
    <section className="px-[22px] pt-[24px]">
      <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
        LAST 30 DAYS
      </span>
      <div
        className="mt-[10px] flex h-[64px] items-end gap-[3px]"
        data-testid="usage-day-strip"
      >
        {days.map((day) => {
          const value = useCost ? (day.costUsd ?? 0) : day.sessions;
          const height = scaleMax > 0 ? (value / scaleMax) * 100 : 0;
          const cost = formatCostUsd(day.costUsd);
          return (
            <div
              key={day.date}
              data-testid={`usage-day-${day.date}`}
              className="flex-1 rounded-[2px]"
              style={{
                height: `${height}%`,
                minHeight: 2,
                background: "var(--agent)",
                opacity: day.sessions ? 0.75 : 0.25,
              }}
              title={`${day.date} · ${day.sessions} sessions${
                cost ? ` · ${cost}` : ""
              }`}
            />
          );
        })}
      </div>
      {days.length > 0 && (
        <div className="mt-[6px] flex justify-between font-mono text-[10.5px] text-meta">
          <span>{formatDayLabel(days[0].date)}</span>
          <span>{formatDayLabel(days[days.length - 1].date)}</span>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Tables                                                                     */
/* -------------------------------------------------------------------------- */

const AGENT_GRID =
  "grid grid-cols-[minmax(160px,2fr)_110px_70px_90px_90px_100px] gap-x-[14px] items-center px-[12px]";

/** Rows arrive sorted by cost desc from the API; no client-side re-sorting. */
function AgentTable({ report }: { report: UsageReport }) {
  return (
    <section className="px-[22px] pt-[24px]">
      <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
        BY AGENT
      </span>
      <div className="mt-[10px] overflow-x-auto" data-testid="usage-agent-table">
        <div
          className={cn(
            AGENT_GRID,
            "py-[6px] text-[11.5px] uppercase tracking-[.08em] text-meta"
          )}
        >
          <span>AGENT</span>
          <span>PROVIDER</span>
          <span className="text-right">RUNS</span>
          <span className="text-right">INPUT</span>
          <span className="text-right">OUTPUT</span>
          <span className="text-right">COST</span>
        </div>
        {report.byAgent.map((row, i) => (
          <div
            key={`${row.namedAgentId ?? "unnamed"}-${row.provider}-${i}`}
            className={cn(AGENT_GRID, "border-b border-border-soft py-[8px]")}
            data-testid={`usage-agent-row-${i}`}
          >
            <span
              className={cn(
                "truncate text-[13px]",
                row.name === null && "text-muted-foreground"
              )}
            >
              {row.name ?? "Unnamed"}
            </span>
            <span className="truncate text-[12.5px] text-muted-foreground">
              {providerLabel(row.provider)}
            </span>
            <span className="text-right font-mono text-[12.5px]">
              {row.sessions}
            </span>
            <span className="text-right font-mono text-[12.5px]">
              {formatTokens(row.inputTokens) ?? "—"}
            </span>
            <span className="text-right font-mono text-[12.5px]">
              {formatTokens(row.outputTokens) ?? "—"}
            </span>
            <span className="text-right font-mono text-[12.5px]">
              {formatCostUsd(row.costUsd) ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProjectList({ report }: { report: UsageReport }) {
  return (
    <section className="px-[22px] pt-[24px]">
      <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
        BY PROJECT
      </span>
      <div className="mt-[10px]" data-testid="usage-project-list">
        {report.byProject.map((row) => (
          <div
            key={row.projectId ?? "none"}
            className="flex items-center justify-between gap-[14px] border-b border-border-soft py-[7px]"
            data-testid={`usage-project-${row.projectId ?? "none"}`}
          >
            {row.projectName === null ? (
              <span className="truncate font-mono text-[12.5px] text-muted-foreground">
                {row.projectId ?? "No project"}
              </span>
            ) : (
              <span className="truncate text-[13px]">{row.projectName}</span>
            )}
            <span className="shrink-0 font-mono text-[12.5px]">
              {row.sessions} session{row.sessions === 1 ? "" : "s"} ·{" "}
              {formatCostUsd(row.costUsd) ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Formatters                                                                 */
/* -------------------------------------------------------------------------- */

function providerLabel(provider: string): string {
  return (PROVIDER_LABELS as Record<string, string>)[provider] ?? provider;
}

/** "3 sessions · $1.24"; the cost half disappears rather than faking $0. */
function sessionsAndCost(
  sessions: number,
  costUsd: number | null,
  emptyLabel: string
): string {
  if (sessions === 0) return emptyLabel;
  const cost = formatCostUsd(costUsd);
  const base = `${sessions} session${sessions === 1 ? "" : "s"}`;
  return cost ? `${base} · ${cost}` : base;
}

/** Local wall clock, 24h — the report's own generation time. */
function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "3d 2h" / "4h 12m" / "12m" — coarse by design, never seconds-accurate. */
function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Age of a snapshot: "less than a minute" / "42m" / "5h" / "62d". */
function formatRelativeAge(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "2026-08-18" -> "Aug 18". Parsed by hand: `new Date("2026-08-18")` is UTC
 * midnight and would render the previous day west of Greenwich, while these
 * keys are already local calendar dates.
 */
function formatDayLabel(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return date;
  return `${MONTH_LABELS[month - 1]} ${day}`;
}
