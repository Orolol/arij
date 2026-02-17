"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NamedAgentSelect } from "@/components/shared/NamedAgentSelect";
import { SessionPicker } from "@/components/shared/SessionPicker";
import { useNamedAgentsList } from "@/hooks/useNamedAgentsList";
import { Loader2, ArrowDownToLine, ArrowUpToLine, RefreshCw } from "lucide-react";

interface StatusResponse {
  data?: {
    branch: string;
    remote: string;
    ahead: number;
    behind: number;
    hasRemoteBranch: boolean;
  };
  error?: string;
}

interface ConflictDiff {
  filePath: string;
  diff: string;
}

export default function GitSyncPage() {
  const params = useParams();
  const projectId = params.projectId as string;

  const [remote, setRemote] = useState("origin");
  const [branch, setBranch] = useState("");
  const [ahead, setAhead] = useState(0);
  const [behind, setBehind] = useState(0);
  const [hasRemoteBranch, setHasRemoteBranch] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [namedAgentId, setNamedAgentId] = useState<string | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string | undefined>(undefined);
  const { agents } = useNamedAgentsList();

  const selectedProvider =
    agents.find((agent) => agent.id === namedAgentId)?.provider || "claude-code";
  const [conflictDiffs, setConflictDiffs] = useState<ConflictDiff[]>([]);
  const [autoResolveConflicts, setAutoResolveConflicts] = useState(true);

  const statusUrl = useMemo(() => {
    const q = new URLSearchParams();
    q.set("remote", remote);
    if (branch.trim()) q.set("branch", branch.trim());
    return `/api/projects/${projectId}/git/status?${q.toString()}`;
  }, [projectId, remote, branch]);

  const refreshStatus = useCallback(async () => {
    setLoadingStatus(true);
    setError(null);
    try {
      const res = await fetch(statusUrl);
      const json = (await res.json()) as StatusResponse;
      if (!res.ok || !json.data) {
        setError(json.error || "Failed to fetch git status");
        return;
      }

      setBranch(json.data.branch);
      setAhead(json.data.ahead);
      setBehind(json.data.behind);
      setHasRemoteBranch(json.data.hasRemoteBranch);
    } catch {
      setError("Failed to fetch git status");
    } finally {
      setLoadingStatus(false);
    }
  }, [statusUrl]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  async function handlePull() {
    setPulling(true);
    setError(null);
    setMessage(null);
    setConflictDiffs([]);

    try {
      const res = await fetch(`/api/projects/${projectId}/git/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remote,
          branch: branch.trim() || undefined,
          autoResolveConflicts,
          namedAgentId,
          resumeSessionId,
        }),
      });

      const json = await res.json();
      if (res.status === 202) {
        setMessage(`Conflicts detected. Resolution agent started (session ${json.data?.sessionId}).`);
        await refreshStatus();
        return;
      }

      if (res.status === 409 && json.data?.conflicted) {
        setError(json.error || "Merge conflicts detected");
        setConflictDiffs(Array.isArray(json.data.conflictDiffs) ? json.data.conflictDiffs : []);
        return;
      }

      if (!res.ok) {
        setError(json.error || "Pull failed");
        return;
      }

      setMessage("Pull completed successfully.");
      await refreshStatus();
    } catch {
      setError("Pull failed");
    } finally {
      setPulling(false);
    }
  }

  async function handlePush() {
    setPushing(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch(`/api/projects/${projectId}/git/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remote,
          branch: branch.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Push failed");
        return;
      }

      setMessage("Push completed successfully.");
      await refreshStatus();
    } catch {
      setError("Push failed");
    } finally {
      setPushing(false);
    }
  }

  return (
    <div className="p-6 max-w-5xl space-y-4">
      <h2 className="text-xl font-bold">Git Sync</h2>

      <Card className="p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Remote</label>
            <Input value={remote} onChange={(e) => setRemote(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Branch</label>
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button variant="outline" onClick={refreshStatus} disabled={loadingStatus}>
              {loadingStatus ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span>Ahead: <b>{ahead}</b></span>
          <span>Behind: <b>{behind}</b></span>
          <span>Remote branch: <b>{hasRemoteBranch ? "yes" : "no"}</b></span>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoResolveConflicts}
            onChange={(e) => setAutoResolveConflicts(e.target.checked)}
          />
          Auto-resolve pull conflicts with agent
        </label>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <NamedAgentSelect
            value={namedAgentId}
            onChange={handleNamedAgentChange}
            className="w-full md:w-[280px]"
          />
          <SessionPicker
            projectId={projectId}
            agentType="merge"
            namedAgentId={namedAgentId}
            provider={selectedProvider}
            selectedSessionId={resumeSessionId}
            onSelect={setResumeSessionId}
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={handlePull} disabled={pulling || loadingStatus}>
            {pulling ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ArrowDownToLine className="h-4 w-4 mr-1" />}
            Pull
          </Button>
          <Button variant="secondary" onClick={handlePush} disabled={pushing || loadingStatus}>
            {pushing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ArrowUpToLine className="h-4 w-4 mr-1" />}
            Push
          </Button>
        </div>

        {message && <p className="text-sm text-green-600">{message}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </Card>

      {conflictDiffs.length > 0 && (
        <Card className="p-4 space-y-4">
          <h3 className="text-sm font-semibold">Manual Conflict Review</h3>
          {conflictDiffs.map((item) => (
            <div key={item.filePath} className="space-y-2">
              <div className="text-xs font-mono text-muted-foreground">{item.filePath}</div>
              <pre className="text-xs p-3 rounded border bg-muted/30 overflow-x-auto whitespace-pre-wrap">
                {item.diff || "No diff output available."}
              </pre>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
  function handleNamedAgentChange(next: string) {
    setNamedAgentId(next);
  }
