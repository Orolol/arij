"use client";

import { useCallback, useEffect, useState } from "react";

/** What a worktree is doing right now, from the agent's point of view. */
export type WorktreeState = "running" | "idle" | "orphan";

export interface WorktreeSummary {
  path: string;
  branch: string | null;
  state: WorktreeState;
  epicId: string | null;
  epicReadableId: string | null;
  epicTitle: string | null;
}

export interface WorktreesResult {
  worktrees: WorktreeSummary[];
  /**
   * Number of agent worktrees, or null while unknown — loading, no git repo,
   * or a failed listing. Callers must render nothing rather than a "0" that
   * would be a lie.
   */
  count: number | null;
  orphanCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** `git worktree prune` — drops records whose directory is already gone. */
  prune: () => Promise<void>;
  pruning: boolean;
}

/**
 * Agent worktrees of a project, from `GET /api/projects/{id}/worktrees`.
 *
 * Deliberately not polled: the route shells out to git, and both consumers
 * (repo status bar, Git Sync column) refresh on an explicit user action.
 */
export function useWorktrees(
  projectId: string,
  enabled: boolean = true
): WorktreesResult {
  const [worktrees, setWorktrees] = useState<WorktreeSummary[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [orphanCount, setOrphanCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((data: unknown) => {
    const payload = data as
      | { worktrees?: WorktreeSummary[]; count?: number; orphanCount?: number }
      | undefined;
    setWorktrees(payload?.worktrees ?? []);
    // Strictly the server's number: an absent count stays unknown rather than
    // becoming a "0 worktrees" nobody vouched for.
    setCount(typeof payload?.count === "number" ? payload.count : null);
    setOrphanCount(payload?.orphanCount ?? 0);
  }, []);

  const refresh = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/worktrees`);
      const json = await res.json();
      if (!res.ok) {
        setCount(null);
        setError(json?.error || "Failed to read worktrees.");
        return;
      }
      setError(null);
      apply(json?.data);
    } catch {
      setCount(null);
      setError("Failed to read worktrees.");
    } finally {
      setLoading(false);
    }
  }, [projectId, enabled, apply]);

  const prune = useCallback(async () => {
    if (!enabled) return;

    setPruning(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/worktrees`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error || "Failed to clean worktrees.");
        return;
      }
      setError(null);
      apply(json?.data);
    } catch {
      setError("Failed to clean worktrees.");
    } finally {
      setPruning(false);
    }
  }, [projectId, enabled, apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    worktrees,
    count,
    orphanCount,
    loading,
    error,
    refresh,
    prune,
    pruning,
  };
}
