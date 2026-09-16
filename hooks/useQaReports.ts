"use client";

import { useTranslations } from "next-intl";

import { useCallback } from "react";
import { usePolledResource } from "./usePolledResource";

import { isCheckLive } from "@/lib/qa/aggregate";

export interface QaReportListItem {
  id: string;
  projectId: string;
  status: "running" | "completed" | "failed" | "cancelled" | string;
  agentSessionId: string | null;
  sessionStatus?: string | null;
  live?: boolean;
  namedAgentId?: string | null;
  promptUsed?: string | null;
  customPromptId?: string | null;
  reportContent?: string | null;
  summary: string | null;
  checkType: string;
  createdAt: string | null;
  completedAt: string | null;
}

const NO_REPORTS: QaReportListItem[] = [];
const isReportList = (value: unknown): value is QaReportListItem[] => Array.isArray(value);

function isReportItemLive(report: QaReportListItem): boolean {
  if (typeof report.live === "boolean") return report.live;
  if (report.sessionStatus !== undefined) {
    return isCheckLive({
      status: report.status ?? null,
      sessionStatus: report.sessionStatus,
    });
  }
  return report.status === "running";
}

const hasRunningReport = (reports: QaReportListItem[] | null) =>
  reports?.some(isReportItemLive) ?? false;

export function useQaReports(projectId: string, intervalMs = 3000) {
  const tErrors = useTranslations("ClientErrors");
  const errorMessage = useCallback(() => tErrors("failedToLoadQAReports"), [tErrors]);
  const { data, loading, error, refresh } = usePolledResource<QaReportListItem[]>(
    `/api/projects/${projectId}/qa/reports`, intervalMs, errorMessage,
    { validateData: isReportList, pollWhen: hasRunningReport },
  );

  return {
    reports: data ?? NO_REPORTS,
    loading,
    error,
    refresh,
  };
}
