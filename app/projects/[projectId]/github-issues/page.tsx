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

  async function syncNow() {
    setSyncing(true);
    try {
      await fetch(`/api/projects/${projectId}/github/issues/sync`, { method: "POST" });
      await loadIssues();
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
      } else {
        setSelected(new Set());
        await loadIssues();
      }
    } catch {
      setError("Import failed");
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
    </div>
  );
}
