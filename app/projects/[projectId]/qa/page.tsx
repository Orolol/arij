"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Activity, Plus, RefreshCw } from "lucide-react";
import { ReportDetail } from "@/components/qa/ReportDetail";
import { StartQaCheckDialog } from "@/components/qa/StartQaCheckDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useQaReports } from "@/hooks/useQaReports";

type FilterCheckType = "tech_check" | "e2e_test" | null;

function formatDate(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  if (status === "cancelled") return "outline";
  return "secondary";
}

function checkTypeBadgeLabel(checkType: string): string {
  return checkType === "e2e_test" ? "E2E" : "Tech";
}

export default function QAPage() {
  const params = useParams();
  const projectId = params.projectId as string;
  const { reports, loading, error, refresh } = useQaReports(projectId);
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [filterCheckType, setFilterCheckType] = useState<FilterCheckType>(null);

  const filteredReports = useMemo(() => {
    if (!filterCheckType) return reports;
    return reports.filter((report) => report.checkType === filterCheckType);
  }, [reports, filterCheckType]);

  useEffect(() => {
    if (filteredReports.length === 0) {
      setSelectedReportId(null);
      return;
    }

    setSelectedReportId((prev) => {
      if (prev && filteredReports.some((report) => report.id === prev)) return prev;
      return filteredReports[0].id;
    });
  }, [filteredReports]);

  const handleStarted = useCallback((data: { reportId: string; sessionId: string }) => {
    setActionMessage("QA check started.");
    setSelectedReportId(data.reportId);
    void refresh();
  }, [refresh]);

  const handleCreateEpics = useCallback((epics: Array<{ id: string; title: string }>) => {
    setActionMessage(
      `Created ${epics.length} epic${epics.length === 1 ? "" : "s"} from QA report.`,
    );
  }, []);

  const stats = useMemo(() => {
    const running = reports.filter((report) => report.status === "running").length;
    const completed = reports.filter((report) => report.status === "completed").length;
    const failed = reports.filter((report) => report.status === "failed").length;
    return { running, completed, failed };
  }, [reports]);

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h2 className="text-xl font-bold">QA</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Run tech checks and E2E tests, review report history, and create epics from findings.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => void refresh()}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Refresh
          </Button>
          <Button size="sm" className="h-8" onClick={() => setStartDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            New Check
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
        <Badge variant="secondary">{stats.running} running</Badge>
        <Badge variant="outline">{stats.completed} completed</Badge>
        <Badge variant="outline">{stats.failed} failed</Badge>
        <span className="mx-1 text-border">|</span>
        <Button
          variant={filterCheckType === null ? "default" : "outline"}
          size="sm"
          className="h-6 text-[11px] px-2"
          onClick={() => setFilterCheckType(null)}
        >
          All
        </Button>
        <Button
          variant={filterCheckType === "tech_check" ? "default" : "outline"}
          size="sm"
          className="h-6 text-[11px] px-2"
          onClick={() => setFilterCheckType("tech_check")}
        >
          Tech Check
        </Button>
        <Button
          variant={filterCheckType === "e2e_test" ? "default" : "outline"}
          size="sm"
          className="h-6 text-[11px] px-2"
          onClick={() => setFilterCheckType("e2e_test")}
        >
          E2E Test
        </Button>
      </div>

      {actionMessage && (
        <Card className="mb-4 p-3 text-xs text-green-600 dark:text-green-400">
          {actionMessage}
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4 flex-1 min-h-0">
        <Card className="h-full flex flex-col">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold">Report History</h3>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Activity className="h-3.5 w-3.5 animate-pulse" />
                Loading reports...
              </div>
            )}
            {!loading && error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
            {!loading && !error && filteredReports.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No QA reports yet. Start a tech check or E2E test to generate a report.
              </p>
            )}

            {filteredReports.map((report) => (
              <button
                key={report.id}
                type="button"
                onClick={() => setSelectedReportId(report.id)}
                className={`w-full rounded-md border p-3 text-left transition-colors ${
                  selectedReportId === report.id
                    ? "border-primary bg-accent"
                    : "border-border hover:bg-accent/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium">#{report.id.slice(0, 8)}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {checkTypeBadgeLabel(report.checkType)}
                    </Badge>
                  </div>
                  <Badge variant={statusVariant(report.status)} className="text-[10px]">
                    {report.status}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {formatDate(report.createdAt)}
                </p>
                {report.summary && (
                  <p className="mt-1 text-xs line-clamp-3 text-muted-foreground">
                    {report.summary}
                  </p>
                )}
              </button>
            ))}
          </div>
        </Card>

        <ReportDetail
          projectId={projectId}
          reportId={selectedReportId}
          onReportUpdated={refresh}
          onCreateEpics={handleCreateEpics}
        />
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
