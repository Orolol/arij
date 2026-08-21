"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PROVIDER_LABELS } from "@/lib/agent-config/constants";
import { useUsage } from "@/hooks/useUsage";
import { cn } from "@/lib/utils";
import { formatCostUsd, formatTokens } from "@/lib/utils/format-usage";
import type {
  ClaudeQuota,
  ClaudeQuotaWindow,
  CodexLiveQuota,
  CodexQuotaBucket,
  SubscriptionStatus,
  SubscriptionWindowStatus,
  UsageReport,
  WindowUsage,
} from "@/lib/types/usage";

/**
 * Usage observatory.
 *
 * Three kinds of number live here and they are never blended:
 *  - live provider quota: what the provider's own CLI answered just now
 *    (`sourceDetail: "live-cli"`), rendered from `claudeLive` / `codexLive`;
 *  - provider-reported snapshot: rate-limit percentages codex itself emitted
 *    into ~/.codex/sessions, replayed verbatim with their capture time;
 *  - metered via Arij: sums over the sessions Arij launched — a floor on real
 *    spend on THIS machine, never the account's remaining quota.
 *
 * When live quota is available for claude, both truths ship: the account
 * gauges lead and the Arij meter is demoted under an explicit
 * "ARIJ-METERED · THIS MACHINE ONLY" label. Percentages are only ever
 * rendered where the provider emitted one — nothing here is derived.
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
            onClick={() => void refresh({ fresh: true })}
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

      {/*
        Body precedence: a live CLI poll wins over every derived view. The
        `source` pill above already flips to "Provider-reported" via the API,
        so the discriminator here is the payload itself (§2c: `claudeLive` /
        `codexLive` are non-null only for `sourceDetail: "live-cli"`).
      */}
      {sub.claudeLive ? (
        <ClaudeLiveBody sub={sub} live={sub.claudeLive} nowMs={nowMs} />
      ) : sub.codexLive ? (
        <CodexLiveBody sub={sub} live={sub.codexLive} nowMs={nowMs} />
      ) : sub.metered ? (
        <MeteredBody sub={sub} metered={sub.metered} />
      ) : (
        <ProviderReportedBody sub={sub} nowMs={nowMs} />
      )}
    </div>
  );
}

/* ----- Live: claude ------------------------------------------------------ */

/**
 * Claude's own account quota, as answered by `claude` over a
 * `control_request get_usage` metadata read (no prompt, zero model tokens).
 *
 * Every gauge here is a `utilization` the provider emitted; nothing is
 * derived, summed or extrapolated. The Arij meter still ships below the
 * divider because it answers a different question ("what did THIS machine
 * spend") — the two are labelled, never blended.
 */
function ClaudeLiveBody({
  sub,
  live,
  nowMs,
}: {
  sub: SubscriptionStatus;
  live: ClaudeQuota;
  nowMs: number;
}) {
  const capturedMs =
    sub.capturedAt === null ? null : new Date(sub.capturedAt).getTime();
  const ageMs =
    capturedMs === null || Number.isNaN(capturedMs) ? null : nowMs - capturedMs;
  const stale = ageMs !== null && ageMs > 24 * 3600_000;
  const extra = live.extraUsage;

  return (
    <>
      <ClaudeWindow
        label="5H WINDOW"
        window={live.fiveHour}
        nowMs={nowMs}
        testId="usage-sub-claude-live-5h"
      />
      <ClaudeWindow
        label="7D WINDOW"
        window={live.sevenDay}
        nowMs={nowMs}
        testId="usage-sub-claude-live-7d"
      />
      <ClaudeWindow
        label="7D OPUS"
        window={live.sevenDayOpus}
        nowMs={nowMs}
        testId="usage-sub-claude-live-7d-opus"
      />
      <ClaudeWindow
        label="7D SONNET"
        window={live.sevenDaySonnet}
        nowMs={nowMs}
        testId="usage-sub-claude-live-7d-sonnet"
      />

      {live.modelScoped
        // A model already shown as a named window (7D OPUS / 7D SONNET)
        // would render as a confusing duplicate gauge — skip it here.
        .filter((model) => {
          const name = model.displayName.toLowerCase();
          if (live.sevenDayOpus !== null && name.includes("opus")) return false;
          if (live.sevenDaySonnet !== null && name.includes("sonnet")) return false;
          return true;
        })
        .map((model, i) => (
          <ClaudeWindow
            key={`${model.displayName}-${i}`}
            label={model.displayName.toUpperCase()}
            window={model}
            nowMs={nowMs}
            testId={`usage-sub-claude-live-model-${i}`}
          />
        ))}

      {extra?.isEnabled && (
        <p
          className="mt-[12px] font-mono text-[11px] text-meta"
          data-testid="usage-sub-claude-extra"
        >
          Extra usage: {numberOrDash(extra.usedCredits)} /{" "}
          {numberOrDash(extra.monthlyLimit)} credits ·{" "}
          {numberOrDash(extra.utilizationPercent)}%
        </p>
      )}

      {ageMs !== null && (
        <p
          className={cn(
            "mt-[12px] text-[11px]",
            stale ? "text-priority-yellow" : "text-meta"
          )}
          data-testid="usage-sub-claude-captured"
        >
          Live · polled {formatRelativeAge(ageMs)} ago · claude CLI
        </p>
      )}

      {sub.metered && (
        <div className="mt-[14px] border-t border-border-soft pt-[10px]">
          {/*
            Demoted rendering: the standalone disclaimer sentence is dropped
            because this section label already says exactly what these numbers
            are — and unlike the fallback card, an account-wide truth is
            visible right above it.
          */}
          <span
            className="text-[10.5px] uppercase tracking-[.08em] text-meta"
            data-testid="usage-sub-claude-metered-sub"
          >
            ARIJ-METERED · THIS MACHINE ONLY
          </span>
          <MeteredLine
            label="LAST 5H"
            usage={sub.metered.last5h}
            testId={`usage-sub-${sub.provider}-5h`}
          />
          <MeteredLine
            label="LAST 7 DAYS"
            usage={sub.metered.last7d}
            testId={`usage-sub-${sub.provider}-7d`}
          />
          {sub.metered.budgetUsdWeek !== null && (
            <GaugeRow
              label="WEEKLY BUDGET"
              readout={`${formatCostUsd(sub.metered.last7d.costUsd) ?? "—"} / ${
                formatCostUsd(sub.metered.budgetUsdWeek) ?? "—"
              }`}
              percent={sub.metered.budgetUsedPercent}
              readoutClassName={
                sub.metered.budgetUsedPercent !== null &&
                sub.metered.budgetUsedPercent > 100
                  ? "text-destructive"
                  : undefined
              }
              testId="usage-sub-claude-budget"
            />
          )}
        </div>
      )}
    </>
  );
}

/**
 * One claude rate-limit window. Claude emits `resets_at` as an ISO-8601
 * STRING; codex emits unix SECONDS. The two conversions live at their own
 * call sites on purpose and must never be merged — only the rendered reset
 * sentence (which takes an already-computed duration) is shared.
 */
function ClaudeWindow({
  label,
  window,
  nowMs,
  testId,
}: {
  label: string;
  window: ClaudeQuotaWindow | null;
  nowMs: number;
  testId: string;
}) {
  if (!window) return null;

  const resetsAtMs = parseIsoMs(window.resetsAtIso);
  const remainingMs = resetsAtMs === null ? null : resetsAtMs - nowMs;

  return (
    <>
      <GaugeRow
        label={label}
        readout={`${Math.round(window.utilizationPercent)}%`}
        percent={window.utilizationPercent}
        dimmed={remainingMs !== null && remainingMs <= 0}
        testId={testId}
      />
      <ResetLine remainingMs={remainingMs} testId={testId} />
    </>
  );
}

/* ----- Live: codex ------------------------------------------------------- */

/**
 * Codex's own account quota, as answered by `codex app-server` over
 * `account/rateLimits/read` + `account/usage/read` (metadata reads, never a
 * turn). Window semantics are NOT constant across accounts or time — this
 * account moved from 300/10080 to 10080/null — so every label is derived
 * from the `windowDurationMins` delivered with the bucket, never assumed.
 */
function CodexLiveBody({
  sub,
  live,
  nowMs,
}: {
  sub: SubscriptionStatus;
  live: CodexLiveQuota;
  nowMs: number;
}) {
  const capturedMs =
    sub.capturedAt === null ? null : new Date(sub.capturedAt).getTime();
  const ageMs =
    capturedMs === null || Number.isNaN(capturedMs) ? null : nowMs - capturedMs;
  const stale = ageMs !== null && ageMs > 24 * 3600_000;
  const credits = live.credits;

  return (
    <>
      {live.buckets.map((bucket) => (
        <CodexBucketRow key={bucket.limitId} bucket={bucket} nowMs={nowMs} />
      ))}

      {credits && (credits.hasCredits || credits.unlimited) && (
        <p
          className="mt-[12px] font-mono text-[11px] text-meta"
          data-testid="usage-sub-codex-credits"
        >
          {credits.unlimited
            ? "Credits: unlimited"
            : `Credits: ${credits.balance ?? "—"}`}
        </p>
      )}

      {ageMs !== null && (
        <p
          className={cn(
            "mt-[12px] text-[11px]",
            stale ? "text-priority-yellow" : "text-meta"
          )}
          data-testid="usage-sub-codex-captured"
        >
          Live · polled {formatRelativeAge(ageMs)} ago · codex app-server
        </p>
      )}

      <CodexHistoryStrip live={live} />
    </>
  );
}

/**
 * One `rateLimitsByLimitId` bucket. `limitName` is the provider's own label
 * ("GPT-5.3-Codex-Spark") and falls back to the raw `limitId` rather than to
 * an invented display name.
 */
function CodexBucketRow({
  bucket,
  nowMs,
}: {
  bucket: CodexQuotaBucket;
  nowMs: number;
}) {
  const name = (bucket.limitName ?? bucket.limitId).toUpperCase();
  const testId = `usage-sub-codex-bucket-${bucket.limitId}`;

  // Codex emits unix SECONDS — the claude path parses ISO strings instead.
  const remainingMs =
    bucket.resetsAtUnix === null ? null : bucket.resetsAtUnix * 1000 - nowMs;
  const secondary = bucket.secondary;
  const secondaryRemainingMs =
    secondary === null || secondary.resetsAtUnix === null
      ? null
      : secondary.resetsAtUnix * 1000 - nowMs;

  return (
    <>
      <GaugeRow
        label={`${name} · ${windowLabel(bucket.windowDurationMins)}`}
        readout={`${Math.round(bucket.usedPercent)}%`}
        percent={bucket.usedPercent}
        dimmed={remainingMs !== null && remainingMs <= 0}
        testId={testId}
      />
      <ResetLine remainingMs={remainingMs} testId={testId} />

      {secondary && (
        <>
          <GaugeRow
            label={`${name} · ${windowLabel(secondary.windowDurationMins)}`}
            readout={`${Math.round(secondary.usedPercent)}%`}
            percent={secondary.usedPercent}
            dimmed={secondaryRemainingMs !== null && secondaryRemainingMs <= 0}
            testId={`${testId}-secondary`}
          />
          <ResetLine
            remainingMs={secondaryRemainingMs}
            testId={`${testId}-secondary`}
          />
        </>
      )}
    </>
  );
}

/**
 * Codex's SERVER-SIDE daily token history: every device on the account, not
 * just this one. Kept inside the codex card behind its own divider and label
 * so it can never be read as the page-level Arij "LAST 30 DAYS" strip.
 *
 * Buckets arrive sparse (days with no usage are simply absent) and are
 * rendered as delivered — no zero-filling, because these are the provider's
 * calendar dates, not Arij's local ones.
 */
function CodexHistoryStrip({ live }: { live: CodexLiveQuota }) {
  const days = live.dailyUsage.slice(-30);
  if (days.length === 0 && live.lifetimeTokens === null) return null;

  const maxTokens = days.reduce((max, d) => Math.max(max, d.tokens), 0);

  return (
    <div className="mt-[14px] border-t border-border-soft pt-[10px]">
      <span
        className="text-[10.5px] uppercase tracking-[.08em] text-meta"
        data-testid="usage-sub-codex-history-label"
      >
        ALL DEVICES · PROVIDER-REPORTED
      </span>

      {days.length > 0 && (
        <>
          <div
            className="mt-[8px] flex h-[40px] items-end gap-[2px]"
            data-testid="usage-sub-codex-history"
          >
            {days.map((day) => (
              <div
                key={day.date}
                data-testid={`usage-sub-codex-history-${day.date}`}
                className="flex-1 rounded-[2px]"
                style={{
                  height: `${maxTokens > 0 ? (day.tokens / maxTokens) * 100 : 0}%`,
                  minHeight: 2,
                  background: "var(--agent)",
                  opacity: day.tokens > 0 ? 0.75 : 0.25,
                }}
                title={`${day.date} · ${formatTokens(day.tokens) ?? "—"} tokens`}
              />
            ))}
          </div>
          <div className="mt-[6px] flex justify-between font-mono text-[10.5px] text-meta">
            <span>{formatDayLabel(days[0].date)}</span>
            <span>{formatDayLabel(days[days.length - 1].date)}</span>
          </div>
        </>
      )}

      {live.lifetimeTokens !== null && (
        <p
          className="mt-[6px] font-mono text-[11px] text-meta"
          data-testid="usage-sub-codex-lifetime"
        >
          Lifetime: {formatTokens(live.lifetimeTokens) ?? "—"} tokens
        </p>
      )}
    </div>
  );
}

/**
 * The reset sentence for one gauge. Purely presentational: it receives an
 * already-computed remaining duration so the claude (ISO) and codex (unix
 * seconds) conversions stay in separate code paths. A window whose reset is
 * already behind us is called stale rather than silently rolled forward.
 */
function ResetLine({
  remainingMs,
  testId,
}: {
  remainingMs: number | null;
  testId: string;
}) {
  return (
    <p
      className="mt-[5px] font-mono text-[11px] text-meta"
      data-testid={`${testId}-reset`}
    >
      {remainingMs === null
        ? "reset time unknown"
        : remainingMs <= 0
          ? "window expired — data stale"
          : `resets in ${formatCountdown(remainingMs)}`}
    </p>
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
      {/*
        Reached only when the live poll produced nothing (missing CLI, timeout,
        malformed frames). The snapshot below is still real provider data, just
        older — say which one is on screen instead of letting them look alike.
      */}
      <p
        className="mt-[10px] text-[11px] text-meta"
        data-testid="usage-sub-codex-live-fallback"
      >
        Live quota unavailable — showing last snapshot.
      </p>
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

  // Snapshot resets are unix SECONDS, like the live codex path and unlike the
  // ISO strings claude emits.
  const resetsAtMs = snapshot.resetsAt === null ? null : snapshot.resetsAt * 1000;
  const remainingMs = resetsAtMs === null ? null : resetsAtMs - nowMs;

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
        dimmed={remainingMs !== null && remainingMs <= 0}
        testId={testId}
      />
      <ResetLine remainingMs={remainingMs} testId={testId} />
    </>
  );
}

/**
 * Claude: sums over Arij's own sessions, never presented as account quota.
 * This is the fallback body — it renders when no live CLI answer was
 * available, so it leads by saying so and keeps its full disclaimer.
 */
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
      <p
        className="mt-[10px] text-[11px] text-meta"
        data-testid="usage-sub-claude-live-fallback"
      >
        Live quota unavailable — showing metered data.
      </p>
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

/**
 * Claude's `resets_at` is an ISO-8601 string ("2026-08-18T16:00:00+00:00").
 * Deliberately NOT routed through the unix-seconds snapshot path: an
 * unparseable value reads as "reset time unknown", never as epoch zero.
 */
function parseIsoMs(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Provider-emitted number, or an em-dash — never a stand-in zero. */
function numberOrDash(value: number | null): string {
  return value === null ? "—" : String(value);
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
