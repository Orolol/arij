"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Activity, Plus, RefreshCw } from "lucide-react";
import { ReportDetail } from "@/components/qa/ReportDetail";
import { StartQaCheckDialog } from "@/components/qa/StartQaCheckDialog";
import {
  BreathingDot,
  Mono,
  PillButton,
  SegmentedControl,
  type SegmentedControlOption,
  SurfaceCard,
} from "@/components/piscine";
import { useQaReports } from "@/hooks/useQaReports";
import { checkTypeLabel, checkStatusLabel, isCheckLive } from "@/lib/qa/aggregate";
import { consumeQueryParam } from "@/lib/navigation/deep-link";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/i18n/format";
import type { TranslationKey } from "@/lib/i18n/catalogue";

type FilterCheckType = "tech_check" | "e2e_test" | "failure_digest" | null;

/**
 * A module-scope copy table, so it holds catalogue KEY REFERENCES and the
 * screen resolves them at render with the namespace-less translator
 * (`lib/i18n/catalogue.ts`, pattern 3).
 */
const CHECK_TYPE_FILTERS: { value: FilterCheckType; labelKey: TranslationKey }[] = [
  { value: null, labelKey: "ProjectQaPage.filters.all" },
  { value: "tech_check", labelKey: "ProjectQaPage.filters.techCheck" },
  { value: "e2e_test", labelKey: "ProjectQaPage.filters.e2eTest" },
  { value: "failure_digest", labelKey: "ProjectQaPage.filters.failureDigest" },
];

export default function QAPage() {
  const locale = useLocale();
  const t = useTranslations("ProjectQaPage");
  // The filter table stores full dotted paths, so it needs the namespace-less
  // translator alongside the namespaced one.
  const tKey = useTranslations();
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as string;
  const { reports, loading, error, refresh } = useQaReports(projectId);
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [filterCheckType, setFilterCheckType] = useState<FilterCheckType>(null);

  // Source links from generated tickets select the referenced report once,
  // then remove the transient parameter so later navigation does not restore
  // a stale selection. Same two-part shape as the desk's ?ticket=/?nightRun=
  // links (app/projects/[projectId]/page.tsx).
  //
  // The selection is plain state of this component, so it is adjusted during
  // render rather than from an effect; only the URL rewrite is a side effect.
  //
  // That rewrite goes through `window.history.replaceState`, not
  // `router.replace`: a replace() is a navigation, and the App Router leaves
  // the spent parameter in the address bar until the destination's RSC payload
  // commits. Inside that window the user can pick another report and reload,
  // and the deep link replays. Nothing on the server reads ?reportId=, so the
  // synchronous query-only rewrite is the right tool — see
  // lib/navigation/deep-link.ts.
  const reportIdParam = searchParams.get("reportId");
  const [handledReportId, setHandledReportId] = useState<string | null>(null);

  if (reportIdParam !== handledReportId) {
    setHandledReportId(reportIdParam);
    if (reportIdParam) {
      setSelectedReportId(reportIdParam);
    }
  }

  useEffect(() => {
    if (!searchParams.get("reportId")) return;
    consumeQueryParam(searchParams, "reportId", `/projects/${projectId}/qa`);
  }, [projectId, searchParams]);

  const filteredReports = useMemo(() => {
    if (!filterCheckType) return reports;
    return reports.filter((report) => report.checkType === filterCheckType);
  }, [reports, filterCheckType]);

  const effectiveSelectedReportId =
    selectedReportId &&
    filteredReports.some((report) => report.id === selectedReportId)
      ? selectedReportId
      : (filteredReports[0]?.id ?? null);

  const selectedReport = useMemo(
    () => reports.find((report) => report.id === effectiveSelectedReportId) ?? null,
    [reports, effectiveSelectedReportId],
  );

  const handleStarted = useCallback((data: {
    reportId: string;
    sessionId: string | null;
    noOp?: boolean;
  }) => {
    setActionMessage(
      data.noOp ? t("actions.digestNoOp") : t("actions.started"),
    );
    setSelectedReportId(data.reportId);
    void refresh();
  }, [refresh, t]);

  const handleCreateEpics = useCallback((epics: Array<{ id: string; title: string }>) => {
    setActionMessage(t("actions.epicsCreated", { count: epics.length }));
  }, [t]);

  const stats = useMemo(() => {
    const running = reports.filter((report) => isCheckLive(report)).length;
    const completed = reports.filter((report) => report.status === "completed").length;
    const failed = reports.filter((report) => report.status === "failed").length;
    const interrupted = reports.filter((report) => checkStatusLabel(report) === "interrupted").length;
    return { running, completed, failed, interrupted };
  }, [reports]);

  const filterOptions = useMemo<SegmentedControlOption<string>[]>(
    () =>
      CHECK_TYPE_FILTERS.map((option) => ({
        value: option.value ?? "all",
        label: tKey(option.labelKey),
      })),
    [tKey],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-[8px] px-[26px] pb-[16px] pt-[20px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-[11px] py-[3px] text-[12.5px] text-muted-foreground">
          {stats.running > 0 ? <BreathingDot size={6} /> : null}
          <Mono size={11} tone="muted">
            {t("page.running", { count: stats.running })}
          </Mono>
        </span>
        <span className="inline-flex items-center rounded-full border border-border px-[11px] py-[3px] text-[12.5px] text-muted-foreground">
          <Mono size={11} tone="muted">
            {t("page.completed", { count: stats.completed })}
          </Mono>
        </span>
        <span className="inline-flex items-center rounded-full border border-border px-[11px] py-[3px] text-[12.5px] text-muted-foreground">
          <Mono size={11} tone="muted">
            {t("page.failed", { count: stats.failed })}
          </Mono>
        </span>
        {stats.interrupted > 0 && (
          <span className="inline-flex items-center rounded-full border border-border px-[11px] py-[3px] text-[12.5px] text-muted-foreground">
            <Mono size={11} tone="muted">
              {t("page.interrupted", { count: stats.interrupted })}
            </Mono>
          </span>
        )}
        <span className="mx-[6px] h-4 w-px bg-border" />
        <SegmentedControl
          options={filterOptions}
          value={filterCheckType ?? "all"}
          onChange={(v) => setFilterCheckType(v === "all" ? null : (v as FilterCheckType))}
        />
        {actionMessage && (
          <span className="text-[12.5px] text-muted-foreground">
            {actionMessage}
          </span>
        )}
        <div className="ml-auto flex items-center gap-[9px]">
          <PillButton
            variant="outline"
            size="sm"
            onClick={() => void refresh()}
          >
            <RefreshCw className="h-[14px] w-[14px]" />
            {t("page.refresh")}
          </PillButton>
          <PillButton
            variant="filled"
            size="sm"
            onClick={() => setStartDialogOpen(true)}
          >
            <Plus className="h-[14px] w-[14px]" />
            {t("page.newCheck")}
          </PillButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-[22px] px-[26px] pb-[26px]">
        <div className="flex w-[340px] flex-none flex-col gap-[10px] overflow-y-auto">
          <Mono size={11} weight={700} tone="muted" className="uppercase tracking-[.08em]">
            {t("page.history")}
          </Mono>

          {loading && (
            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Activity className="h-3.5 w-3.5 animate-pulse" />
              {t("page.loading")}
            </div>
          )}
          {!loading && error && (
            <p className="text-[12.5px] text-muted-foreground">{error}</p>
          )}
          {!loading && !error && filteredReports.length === 0 && (
            <p className="text-[12.5px] text-muted-foreground">
              {t("page.empty")}
            </p>
          )}

          {filteredReports.map((report) => {
            const isLive = isCheckLive(report);
            const statusLabel = checkStatusLabel(report);
            const isSelected = effectiveSelectedReportId === report.id;

            return (
              <button
                key={report.id}
                type="button"
                onClick={() => setSelectedReportId(report.id)}
                className={cn(
                  "block w-full text-left outline-none rounded-[11px]",
                  "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <SurfaceCard
                  radius={11}
                  interactive
                  selected={isSelected}
                  className="flex flex-col gap-[8px] px-[16px] py-[14px]"
                >
                  <div className="flex items-center gap-[8px]">
                    <Mono size={11} weight={700} tone="feed-deep" className="shrink-0">
                      {checkTypeLabel(report.checkType)}
                    </Mono>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {isLive ? <BreathingDot size={6} /> : null}
                      <Mono size={10} tone="muted">
                        {statusLabel}
                      </Mono>
                    </span>
                    <Mono size={11} tone="muted" className="ml-auto">
                      {formatRelative(report.createdAt, { locale })}
                    </Mono>
                  </div>
                  <span className="line-clamp-2 text-[13.5px] font-medium leading-[1.35] text-foreground">
                    {report.summary || `#${report.id.slice(0, 8)}`}
                  </span>
                </SurfaceCard>
              </button>
            );
          })}
        </div>

        <div className="min-w-0 flex-1">
          <ReportDetail
            projectId={projectId}
            reportId={effectiveSelectedReportId}
            live={selectedReport ? isCheckLive(selectedReport) : undefined}
            onCreateEpics={handleCreateEpics}
          />
        </div>
      </div>

      <StartQaCheckDialog
        projectId={projectId}
        open={startDialogOpen}
        onOpenChange={setStartDialogOpen}
        onStarted={handleStarted}
      />
    </div>
  );
}
