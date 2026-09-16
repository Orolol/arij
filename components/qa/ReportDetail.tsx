"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, Loader2, Plus, Sparkles, XCircle } from "lucide-react";
import { BreathingDot, Mono, PillButton } from "@/components/piscine";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { usePolledResource } from "@/hooks/usePolledResource";
import { useScopedMutation } from "@/hooks/useScopedMutation";
import { requestJson } from "@/lib/api/client";
import type { TranslationKey } from "@/lib/i18n/catalogue";
import { formatDateTime } from "@/lib/i18n/format";
import { checkStatusLabel } from "@/lib/qa/aggregate";
import { cn } from "@/lib/utils";

interface QaReport {
  id: string;
  projectId: string;
  status: string;
  agentSessionId?: string | null;
  summary: string | null;
  reportContent: string | null;
  checkType?: string;
  createdAt: string | null;
  completedAt: string | null;
}

interface ReportDetailProps {
  projectId: string;
  reportId: string | null;
  live?: boolean;
  onCreateEpics?: (epics: Array<{ id: string; title: string }>) => void;
}

type Severity = "critical" | "major" | "minor";

interface ParsedFinding {
  key: string;
  severity: Severity;
  title: string;
  path: string | null;
}

/**
 * The stamp word and the tile word per severity. Module-scope copy tables, so
 * they hold catalogue KEY REFERENCES resolved at render with the
 * namespace-less translator (`lib/i18n/catalogue.ts`, pattern 3) — an
 * id → key choice is always an explicit map.
 */
const SEVERITY_COPY: Record<
  Severity,
  { labelKey: TranslationKey; nameKey: TranslationKey }
> = {
  critical: {
    labelKey: "Qa.report.severityLabels.critical",
    nameKey: "Qa.report.severityNames.critical",
  },
  major: {
    labelKey: "Qa.report.severityLabels.major",
    nameKey: "Qa.report.severityNames.major",
  },
  minor: {
    labelKey: "Qa.report.severityLabels.minor",
    nameKey: "Qa.report.severityNames.minor",
  },
};

const SEVERITY_TONE: Record<Severity, string> = {
  critical: "text-destructive",
  major: "text-primary",
  minor: "text-meta",
};

/** QA prompts ask for Critical/High/Major/Medium/Minor/Low severities. */
const SEVERITY_WORDS: Record<string, Severity> = {
  critical: "critical",
  blocker: "critical",
  high: "major",
  major: "major",
  medium: "minor",
  minor: "minor",
  low: "minor",
  info: "minor",
  suggestion: "minor",
  nit: "minor",
};

const SEVERITY_ALTERNATION =
  "critical|blocker|high|major|medium|minor|low|info|suggestion|nit";
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*)$/;
const INLINE_RE = new RegExp(
  `^\\s{0,3}(?:[-*+]\\s+|\\d+\\.\\s+|#{1,6}\\s+)?[*_\`\\[]{0,2}(${SEVERITY_ALTERNATION})[*_\`\\]]{0,2}\\s*[:\\-–—|]\\s*(.+)$`,
  "i",
);
const SEVERITY_FIELD_RE = new RegExp(
  `^\\s{0,3}(?:[-*+]\\s+)?\\**severity\\**\\s*[:\\-]\\s*\\**\\s*(${SEVERITY_ALTERNATION})\\b`,
  "i",
);
const BACKTICK_PATH_RE = /`([^`\n]*[/.][^`\n]*)`/;
const BARE_PATH_RE =
  /(?:^|[\s(])((?:[\w.-]+\/)+[\w.-]+\.[A-Za-z]{1,6}(?::\d+)?)/;

function stripMarkdown(value: string): string {
  return value
    .replace(/[*_`]+/g, "")
    .replace(/^\[|\]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPath(...candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const backticked = BACKTICK_PATH_RE.exec(candidate);
    if (backticked) return backticked[1].trim();
    const bare = BARE_PATH_RE.exec(candidate);
    if (bare) return bare[1].trim();
  }
  return null;
}

function cleanTitle(raw: string, path: string | null): string {
  let title = stripMarkdown(raw);
  if (path) {
    title = title.replace(path, "");
  }
  title = title.replace(/[\s(),—–-]+$/g, "").replace(/^[\s—–-]+/, "").trim();
  return title.length > 180 ? `${title.slice(0, 180)}…` : title;
}

/**
 * Best-effort structuring of the agent's markdown report. QA reports are free
 * prose — anything that does not clearly announce a severity is left alone and
 * the raw report stays available below the list.
 */
export function parseFindings(content: string | null): ParsedFinding[] {
  if (!content) return [];

  const lines = content.split("\n");
  const findings: ParsedFinding[] = [];
  const seen = new Set<string>();
  let lastHeading: string | null = null;

  const push = (severity: Severity, title: string, path: string | null) => {
    if (title.replace(/[^A-Za-z0-9]/g, "").length < 6) return;
    const dedupeKey = `${severity}|${title.toLowerCase()}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    findings.push({ key: `${findings.length}-${dedupeKey}`, severity, title, path });
  };

  for (let i = 0; i < lines.length && findings.length < 200; i += 1) {
    const line = lines[i];

    const inline = INLINE_RE.exec(line);
    if (inline) {
      const severity = SEVERITY_WORDS[inline[1].toLowerCase()];
      const path = extractPath(inline[2], lines[i + 1]);
      if (severity) push(severity, cleanTitle(inline[2], path), path);
      continue;
    }

    const field = SEVERITY_FIELD_RE.exec(line);
    if (field && lastHeading) {
      const severity = SEVERITY_WORDS[field[1].toLowerCase()];
      const path = extractPath(lines[i + 1], lines[i + 2], lastHeading);
      if (severity) push(severity, cleanTitle(lastHeading, path), path);
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) lastHeading = stripMarkdown(heading[1]);
  }

  return findings;
}

function formatDuration(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function ReportDetail(props: ReportDetailProps) {
  return <ReportWorkspace key={JSON.stringify([props.projectId, props.reportId])} {...props} />;
}

function ReportWorkspace({
  projectId,
  reportId,
  live,
  onCreateEpics,
}: ReportDetailProps) {
  const locale = useLocale();
  const t = useTranslations("Qa");
  // The severity tables hold full dotted paths, so they resolve through the
  // namespace-less translator.
  const tKey = useTranslations();
  const errorMessage = useCallback(() => t("report.errors.load"), [t]);
  const url = reportId ? `/api/projects/${projectId}/qa/reports/${reportId}` : null;
  const pollWhen = useCallback(
    (current: QaReport | null) => {
      if (typeof live === "boolean") return live && current?.status === "running";
      return current?.status === "running";
    },
    [live],
  );
  const { data: report, loading, error: loadError, refresh: loadReport } = usePolledResource<QaReport>(
    url, 3000, errorMessage, { pollWhen },
  );
  const { run, pending: creatingEpics, error: mutationError } = useScopedMutation(url);
  const error = mutationError || loadError;
  const [generationSessionId, setGenerationSessionId] = useState<string | null>(null);
  const [createdEpics, setCreatedEpics] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedFindings, setSelectedFindings] = useState<Set<string>>(new Set());

  async function handleCreateEpics() {
    if (!report || !url) return;
    const result = await run(async () => {
      const response = await requestJson<{ epics?: Array<{ id: string; title: string }>; sessionId?: string }>(`${url}/create-epics`, {
        method: "POST", errorMessage: t("report.errors.createEpics"),
      });
      if (response.error !== null) throw new Error(response.error);
      return response.data;
    }, t("report.errors.createEpics"));
    if (result) {
      if (result.sessionId) setGenerationSessionId(result.sessionId);
      if (result.epics) { setCreatedEpics(result.epics); onCreateEpics?.(result.epics); }
    }
  }

  const heading = useMemo(() => {
    if (!report) return t("report.fallbackHeading");
    const label =
      report.checkType === "e2e_test"
        ? t("checkTypes.e2eTest.name")
        : report.checkType === "failure_digest"
          ? t("checkTypes.failureDigest.name")
          : t("checkTypes.techCheck.name");
    return t("report.heading", { label, id: report.id.slice(0, 8) });
  }, [report, t]);

  const findings = useMemo(
    () => parseFindings(report?.reportContent ?? null),
    [report?.reportContent],
  );

  const severityCounts = useMemo(() => {
    const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0 };
    for (const finding of findings) counts[finding.severity] += 1;
    return counts;
  }, [findings]);

  function toggleFinding(key: string) {
    setSelectedFindings((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleExportMarkdown() {
    if (!report) return;
    const chosen = findings.filter((finding) => selectedFindings.has(finding.key));
    const source = chosen.length > 0 ? chosen : findings;
    const body =
      source.length > 0
        ? source
            .map(
              (finding) =>
                `- **${tKey(SEVERITY_COPY[finding.severity].labelKey)}** — ${finding.title}${
                  finding.path ? ` (\`${finding.path}\`)` : ""
                }`,
            )
            .join("\n")
        : report.reportContent || "";

    const markdown = `# ${heading}\n\n${body}\n`;

    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `qa-${report.id.slice(0, 8)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!reportId) {
    return (
      <div className="flex h-full min-h-0 flex-col rounded-[12px] border border-border bg-card px-[24px] py-[22px]">
        <p className="text-[13px] text-muted-foreground">
          {t("report.emptySelection")}
        </p>
      </div>
    );
  }

  if (loading && !report) {
    return (
      <div className="flex h-full min-h-0 flex-col rounded-[12px] border border-border bg-card px-[24px] py-[22px]">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("report.loading")}
        </div>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="flex h-full min-h-0 flex-col rounded-[12px] border border-destructive/50 bg-card px-[24px] py-[22px]">
        <div className="flex items-center gap-2 text-[13px] text-destructive">
          <XCircle className="h-4 w-4" />
          {error}
        </div>
        <PillButton variant="outline" size="sm" onClick={() => void loadReport()}>{t("report.retry")}</PillButton>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex h-full min-h-0 flex-col rounded-[12px] border border-border bg-card px-[24px] py-[22px]">
        <p className="text-[13px] text-muted-foreground">
          {t("report.notFound")}
        </p>
      </div>
    );
  }

  const duration = formatDuration(report.createdAt, report.completedAt);
  const isEmptyFailureDigest =
    report.checkType === "failure_digest" && report.agentSessionId === null;
  const canCreateEpics =
    report.status === "completed" &&
    Boolean(report.reportContent) &&
    !isEmptyFailureDigest;

  const displayStatus = typeof live === "boolean"
    ? checkStatusLabel({ status: report.status, sessionStatus: live ? "running" : null })
    : report.status;
  const isLive = typeof live === "boolean" ? live : report.status === "running";

  return (
    <div className="flex h-full min-h-0 flex-col gap-[16px] rounded-[12px] border border-border bg-card px-[24px] py-[22px]">
      <div className="flex flex-wrap items-center gap-[12px]">
        <h3 className="text-[17px] font-semibold">{heading}</h3>
        <span className="inline-flex items-center gap-[7px] rounded-full bg-band px-[10px] py-[4px]">
          {isLive ? <BreathingDot size={6} /> : null}
          <Mono size={11} tone="muted">
            {duration
              ? t("report.statusDuration", { status: displayStatus, duration })
              : displayStatus}
          </Mono>
        </span>
        <span className="ml-auto font-mono text-[11px] text-meta">
          {formatDateTime(report.createdAt, { locale, style: "dateTimeSeconds" }) || "-"}
        </span>
      </div>

      {report.summary && (
        <p className="line-clamp-3 text-[13px] leading-[1.55] text-muted-foreground">
          {report.summary}
        </p>
      )}

      {findings.length > 0 && (
        <div className="flex gap-[10px]">
          {(["critical", "major", "minor"] as Severity[]).map((severity) => (
            <div
              key={severity}
              className="flex flex-1 flex-col gap-[2px] rounded-[11px] bg-band p-[13px]"
            >
              <span
                className={cn(
                  "text-[20px] font-semibold leading-none",
                  SEVERITY_TONE[severity],
                )}
              >
                {severityCounts[severity]}
              </span>
              <span className="text-[12px] text-muted-foreground">
                {tKey(SEVERITY_COPY[severity].nameKey)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {report.status === "running" && (
          <div className="mb-3 inline-flex items-center gap-2 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {report.checkType === "e2e_test"
              ? t("report.stillRunning.e2eTest")
              : report.checkType === "failure_digest"
                ? t("report.stillRunning.failureDigest")
                : t("report.stillRunning.techCheck")}
          </div>
        )}

        {findings.length > 0 ? (
          <>
            <span className="text-[11.5px] uppercase tracking-[.08em] text-meta">
              {t("report.findingsHeading")}
            </span>
            {findings.map((finding) => (
              <label
                key={finding.key}
                className="flex cursor-pointer gap-[12px] border-t border-border-soft py-[13px]"
              >
                <span
                  className={cn(
                    "min-w-[64px] font-mono text-[11px]",
                    SEVERITY_TONE[finding.severity],
                  )}
                >
                  {tKey(SEVERITY_COPY[finding.severity].labelKey)}
                </span>
                <span className="flex flex-1 flex-col gap-[3px]">
                  <span className="text-[13.5px] leading-[1.45]">
                    {finding.title}
                  </span>
                  {finding.path && (
                    <span className="font-mono text-[11px] text-meta">
                      {finding.path}
                    </span>
                  )}
                </span>
                <input
                  type="checkbox"
                  aria-label={t("report.selectFinding", { title: finding.title })}
                  checked={selectedFindings.has(finding.key)}
                  onChange={() => toggleFinding(finding.key)}
                  className="mt-[2px] h-[16px] w-[16px] flex-none accent-primary"
                />
              </label>
            ))}
            <details className="mt-[16px]">
              <summary className="cursor-pointer text-[12.5px] text-muted-foreground">
                {t("report.fullReport")}
              </summary>
              <div className="mt-[10px] text-[13.5px] leading-[1.6]">
                <MarkdownContent content={report.reportContent || ""} />
              </div>
            </details>
          </>
        ) : report.reportContent?.trim() ? (
          <div className="text-[13.5px] leading-[1.6]">
            <MarkdownContent content={report.reportContent} />
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {report.status === "running"
              ? t("report.waitingOutput")
              : t("report.noContent")}
          </p>
        )}
      </div>

      {createdEpics.length > 0 && (
        <div className="inline-flex items-center gap-1 text-[12.5px] text-agent">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t("report.createdEpics", { count: createdEpics.length })}
        </div>
      )}
      {error && <p className="text-[12.5px] text-destructive">{error}</p>}

      <div className="flex flex-wrap items-center gap-[10px]">
        <span className="text-[12.5px] text-muted-foreground">
          {t("report.selectedFindings", { count: selectedFindings.size })}
        </span>
        <span className="ml-auto flex items-center gap-[10px]">
          <PillButton
            variant="outline"
            size="sm"
            onClick={handleExportMarkdown}
            disabled={!report.reportContent}
          >
            {t("report.exportMarkdown")}
          </PillButton>
          {canCreateEpics && (
            <>
            {generationSessionId && <a className="text-sm underline" href={`/projects/${projectId}/sessions/${generationSessionId}`}>{t("report.generationSession")}</a>}
            <PillButton
              variant="filled"
              size="sm"
              onClick={handleCreateEpics}
              disabled={creatingEpics}
            >
              {creatingEpics ? (
                <Loader2 className="h-[14px] w-[14px] animate-spin" />
              ) : findings.length > 0 ? (
                <Plus className="h-[14px] w-[14px]" />
              ) : (
                <Sparkles className="h-[14px] w-[14px]" />
              )}
              {t("report.createEpics")}
            </PillButton>
            </>
          )}
        </span>
      </div>
    </div>
  );
}
