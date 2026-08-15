"use client";

import { useCallback, useEffect, useState } from "react";
import { usePolling } from "@/hooks/usePolling";

export interface QaReportListItem {
  id: string;
  projectId: string;
  status: "running" | "completed" | "failed" | "cancelled" | string;
  agentSessionId: string | null;
  namedAgentId: string | null;
  promptUsed: string | null;
  customPromptId: string | null;
  reportContent: string | null;
  summary: string | null;
  checkType: string;
  createdAt: string | null;
  completedAt: string | null;
}

export function useQaReports(projectId: string, intervalMs = 3000) {
  const [reports, setReports] = useState<QaReportListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/qa/reports`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Failed to load QA reports");
        return;
      }
      const next = (json.data || []) as QaReportListItem[];
      setReports((prev) => {
        if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
        return next;
      });
      setError(null);
    } catch {
      setError("Failed to load QA reports");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  // Poll only while a report is running; the initial load above already
  // fetched, so skip the immediate call.
  const hasRunningReport = reports.some((report) => report.status === "running");
  usePolling(refresh, intervalMs, hasRunningReport, { immediate: false });

  return {
    reports,
    loading,
    error,
    refresh,
  };
}
