"use client";

/**
 * VERIFICATION on the land ground — the mechanical evidence half of the
 * ticket, on the same ground as the GIT band that acts on it.
 *
 * WHAT IT DRAWS. The newest `verify_reports` row for the epic: the run's
 * verdict, then one row per human-configured command with its name, the exact
 * command line, its exit code, its wall time and its bounded output tail. The
 * report is fetched by `useEpicDetail` and handed down by
 * `hooks/useTicketOverlayData.ts`; this band owns no fetching of its own, and
 * the manual re-run is a callback like every other action in the overlay.
 *
 * STATE IS A WORD, NOT A COLOUR. The run's verdict is a `Stamp` — the land
 * family for a pass, the coral family for a failure — exactly like the
 * acceptance-grading stamp one band above. The per-command verdict is the
 * bare word PASS / FAIL in the band's own mid tone: a column of coral stamps
 * would spend the screen's one alarm colour on every row of a routine report.
 *
 * A FAILING COMMAND OPENS ITSELF. The tail is what the user opened the ticket
 * for, and keeping it behind a toggle on the one row that matters is the
 * whole defect this band exists to close. Passing commands stay collapsed.
 *
 * NO EXIT CODE IS NOT EXIT ZERO. `exitCode: null` means the command timed out
 * or never started; it renders as an em dash, never as `exit 0`, which would
 * read as a pass.
 *
 * EMPTY STATE: no report renders the label line and the run action, and
 * nothing else — `StrataBand` has no padding floor, so the band collapses on
 * its own. There is no "not verified yet" copy, here or anywhere in Piscine.
 */

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  BandHeader,
  Mono,
  PillButton,
  QuietLink,
  Stamp,
  StrataBand,
} from "@/components/piscine";
import { formatDateTime } from "@/lib/i18n/format";
import type { UiLocale } from "@/lib/i18n/locales";
import type {
  VerificationReport,
  VerifyCommandResult,
} from "@/lib/verify/verify-constants";

export interface VerifyBandProps {
  /** Newest persisted report for this epic; `null` = never verified. */
  report: VerificationReport | null;
  /** POSTs the verify route and installs whatever it returns. */
  onRun: () => void;
  running: boolean;
  /** The route's own refusal, verbatim — not a generic failure line. */
  error: string | null;
  /**
   * An agent occupies the epic. The route answers 409 in that state, so the
   * pill says so before the request rather than after it.
   */
  locked: boolean;
}

export function VerifyBand({
  report,
  onRun,
  running,
  error,
  locked,
}: VerifyBandProps) {
  const t = useTranslations("Ticket");
  const locale = useLocale() as UiLocale;

  const passed = report
    ? report.commands.filter((command) => command.exitCode === 0).length
    : 0;

  return (
    // `StrataBand` takes no `...rest`, so a `data-testid` handed to it would
    // type-check and then vanish before the DOM — the standing Piscine trap.
    // A `display: contents` wrapper carries the id without adding a box, so
    // the band stays a direct flex item of the overlay's left column.
    <div className="contents" data-testid="ticket-verify-band">
      <StrataBand
        stratum="land"
        density="rail"
        gap={8}
        className="shrink-0 pb-[15px]"
      >
        <BandHeader
          label={t("verify.label")}
          stratum="land"
          className="gap-[10px]"
          meta={
            report
              ? t("verify.meta", {
                  passed: String(passed),
                  total: String(report.commands.length),
                  when: formatDateTime(report.finishedAt, { locale }),
                })
              : undefined
          }
          right={
            report ? (
              <Stamp
                tone={report.status === "pass" ? "land" : "failed"}
                className="shrink-0"
              >
                {report.status === "pass"
                  ? t("verify.passed")
                  : t("verify.failed")}
              </Stamp>
            ) : undefined
          }
        />

        {report ? (
          <div
            data-testid="ticket-verify-report"
            className="flex flex-col gap-[6px]"
          >
            {report.commands.map((command, index) => (
              <CommandRow
                // Two entries of a hand-written command list may legitimately
                // share a name; the index is what keeps their rows apart.
                key={`${command.name}-${index}`}
                command={command}
              />
            ))}
          </div>
        ) : null}

        <div className="flex">
          <PillButton
            variant="outline"
            outlineTone="action"
            size="sm"
            icon={FlaskConical}
            onClick={onRun}
            pending={running}
            pendingLabel={t("verify.running")}
            disabled={locked}
            data-testid="ticket-verify-run"
          >
            {t("verify.run")}
          </PillButton>
        </div>

        {error ? (
          <p
            data-testid="ticket-verify-error"
            role="alert"
            className="m-0 text-[12px] leading-[1.5] text-strata-you-deep"
          >
            {error}
          </p>
        ) : null}
      </StrataBand>
    </div>
  );
}

/** `2.4 s` · `640 ms` · `10 min` — whole units, never a raw millisecond count. */
function useDurationLabel(durationMs: number): string {
  const t = useTranslations("Ticket");
  if (durationMs < 1_000) {
    return t("verify.durationMs", {
      ms: String(Math.max(0, Math.round(durationMs))),
    });
  }
  if (durationMs < 60_000) {
    return t("verify.durationSeconds", {
      // One decimal under ten seconds, where the tenth is the difference
      // between two runs; whole seconds above it, where it is noise.
      seconds: (durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0),
    });
  }
  return t("verify.durationMinutes", {
    minutes: String(Math.round(durationMs / 60_000)),
  });
}

function CommandRow({ command }: { command: VerifyCommandResult }) {
  const t = useTranslations("Ticket");
  const passed = command.exitCode === 0;
  // The one row the user came for opens itself; the rest stay quiet.
  const [expanded, setExpanded] = useState(!passed);
  const duration = useDurationLabel(command.durationMs);
  const tail = command.tail.trim();

  return (
    <div
      data-testid="ticket-verify-command"
      data-name={command.name}
      data-status={passed ? "pass" : "fail"}
      className="flex flex-col gap-[5px] rounded-[10px] bg-card px-3 py-[9px]"
    >
      <div className="flex flex-wrap items-baseline gap-x-[10px] gap-y-[3px]">
        <span className="min-w-0 flex-1 line-clamp-1 text-[13px] font-medium text-foreground">
          {command.name}
        </span>
        <Mono size={10} tone="land-mid" className="shrink-0 font-bold uppercase">
          {passed ? t("verify.commandPassed") : t("verify.commandFailed")}
        </Mono>
        <Mono size={10} tone="land-mid" className="shrink-0">
          {command.exitCode === null
            ? t("verify.exitUnknown")
            : t("verify.exit", { code: String(command.exitCode) })}
        </Mono>
        <Mono size={10} tone="land-mid" className="shrink-0">
          {duration}
        </Mono>
      </div>

      <Mono size={10.5} tone="muted" as="div" clamp={1}>
        {command.command}
      </Mono>

      <div className="flex">
        <QuietLink
          tone="land"
          size={11.5}
          onClick={() => setExpanded((value) => !value)}
          testId="ticket-verify-output-toggle"
        >
          {expanded ? t("verify.hideOutput") : t("verify.showOutput")}
        </QuietLink>
      </div>

      {expanded ? (
        // A tail carries compiler and test-runner output: long unbroken tokens
        // and wide stack frames both live here, so it wraps AND scrolls rather
        // than widening the whole modal on a narrow viewport.
        //
        // `--muted` is the system's sunken surface and the ground every other
        // output block in the app sits on (the spec progress log, the markdown
        // fence, the comment tail). It reads as recessed against `--card` in
        // BOTH themes, where a translucent `--background` was invisible on the
        // near-white day card.
        <pre
          data-testid="ticket-verify-output"
          className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-muted p-2 font-mono text-[10.5px] leading-[1.5] text-foreground"
        >
          {tail || t("verify.noOutput")}
        </pre>
      ) : null}
    </div>
  );
}

export default VerifyBand;
