"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, RefreshCw } from "lucide-react";

interface GitHubIssueRow {
  id: string;
  issueNumber: number;
  title: string;
  labels: string[];
  milestone: string | null;
  githubUrl: string;
  createdAtGitHub: string | null;
  importedEpicId: string | null;
}

interface Toast {
  id: string;
  type: "success" | "error";
  message: string;
}

export default function GitHubIssuesPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [issues, setIssues] = useState<GitHubIssueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [labelFilter, setLabelFilter] = useState("");
  const [milestoneFilter, setMilestoneFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [featureLabels, setFeatureLabels] = useState("");
  const [bugLabels, setBugLabels] = useState("");
  const [savingMapping, setSavingMapping] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((type: "success" | "error", message: string) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const loadIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams();
    if (labelFilter.trim()) query.set("label", labelFilter.trim());
    if (milestoneFilter.trim()) query.set("milestone", milestoneFilter.trim());

    try {
      const res = await fetch(`/api/projects/${projectId}/github/issues/triage?${query.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Failed to load issues");
      } else {
        setIssues(json.data || []);
      }
    } catch {
      setError("Failed to load issues");
    } finally {
      setLoading(false);
    }
  }, [projectId, labelFilter, milestoneFilter]);

  useEffect(() => {
    loadIssues();
  }, [loadIssues]);

  useEffect(() => {
    fetch(`/api/projects/${projectId}/github/label-mapping`)
      .then((r) => r.json())
      .then((json) => {
        if (json.data) {
          setFeatureLabels(json.data.featureLabels.join(", "));
          setBugLabels(json.data.bugLabels.join(", "));
        }
      })
      .catch(() => {});
  }, [projectId]);

  async function saveMappingConfig() {
    setSavingMapping(true);
    try {
      await fetch(`/api/projects/${projectId}/github/label-mapping`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureLabels: featureLabels
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          bugLabels: bugLabels
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
    } finally {
      setSavingMapping(false);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      await fetch(`/api/projects/${projectId}/github/issues/sync`, { method: "POST" });
      await loadIssues();
      showToast("success", "Issues synced");
    } finally {
      setSyncing(false);
    }
  }

  async function importSelected() {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/github/issues/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueNumbers: Array.from(selected) }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Import failed");
        showToast("error", json.error || "Import failed");
      } else {
        setSelected(new Set());
        await loadIssues();
        showToast("success", "Imported " + selected.size + " issues");
      }
    } catch {
      setError("Import failed");
      showToast("error", "Import failed");
    } finally {
      setImporting(false);
    }
  }

  const visible = useMemo(() => issues, [issues]);

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">GitHub Issue Triage</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={syncNow} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Sync
          </Button>
          <Button onClick={importSelected} disabled={importing || selected.size === 0}>
            {importing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            Import Selected ({selected.size})
          </Button>
        </div>
      </div>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Filter by label</label>
          <Input value={labelFilter} onChange={(e) => setLabelFilter(e.target.value)} placeholder="bug" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Filter by milestone</label>
          <Input value={milestoneFilter} onChange={(e) => setMilestoneFilter(e.target.value)} placeholder="v1.0" />
        </div>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading issues...</p>
      ) : (
        <Card className="p-4 space-y-3">
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open issues found.</p>
          ) : (
            visible.map((issue) => {
              const checked = selected.has(issue.issueNumber);
              return (
                <label key={issue.id} className="flex items-start gap-3 p-2 rounded hover:bg-accent/50">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (value) next.add(issue.issueNumber);
                        else next.delete(issue.issueNumber);
                        return next;
                      });
                    }}
                    disabled={Boolean(issue.importedEpicId)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a href={issue.githubUrl} className="font-medium hover:underline" target="_blank" rel="noreferrer">
                        #{issue.issueNumber} {issue.title}
                      </a>
                      {issue.importedEpicId ? (
                        <Badge className="bg-green-600 text-white">Imported</Badge>
                      ) : (
                        <Badge variant="outline">Not Imported</Badge>
                      )}
                      {issue.createdAtGitHub && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(issue.createdAtGitHub).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {issue.labels.map((label) => (
                        <Badge key={label} variant="secondary" className="text-[10px]">
                          {label}
                        </Badge>
                      ))}
                      {issue.milestone && (
                        <Badge variant="outline" className="text-[10px]">
                          {issue.milestone}
                        </Badge>
                      )}
                    </div>
                  </div>
                </label>
              );
            })
          )}
        </Card>
      )}

      <Card className="p-4 space-y-3">
        <h3 className="text-sm font-semibold">Label Mapping Configuration</h3>
        <p className="text-xs text-muted-foreground">
          Configure which GitHub labels map to Feature (Epic) or Bug ticket types.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Feature labels (comma-separated)</label>
            <Input
              value={featureLabels}
              onChange={(e) => setFeatureLabels(e.target.value)}
              placeholder="feature, enhancement, epic"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Bug labels (comma-separated)</label>
            <Input
              value={bugLabels}
              onChange={(e) => setBugLabels(e.target.value)}
              placeholder="bug, defect, error"
            />
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={saveMappingConfig} disabled={savingMapping}>
          {savingMapping ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          Save Mapping
        </Button>
      </Card>
    </div>
  );
}
