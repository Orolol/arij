"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { requestJson } from "@/lib/api/client";
import { usePolledResource } from "@/hooks/usePolledResource";
import { useScopedMutation } from "@/hooks/useScopedMutation";

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
  /** Unknown until a successful listing; never invent a zero after an error. */
  count: number | null;
  orphanCount: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Drops git records whose directory is already gone. */
  prune: () => Promise<void>;
  pruning: boolean;
}

interface WorktreeData {
  worktrees: WorktreeSummary[];
  count: number | null;
  orphanCount: number;
}

const NO_WORKTREES: WorktreeSummary[] = [];
function isWorktreeData(value: unknown): value is WorktreeData {
  if (!value || typeof value !== "object") return false;
  const data = value as WorktreeData;
  return Array.isArray(data.worktrees)
    && (data.count === null || (Number.isInteger(data.count) && data.count >= 0))
    && Number.isInteger(data.orphanCount) && data.orphanCount >= 0;
}

/** One explicit read: polling this resource would repeatedly shell out to git. */
export function useWorktrees(projectId: string, enabled: boolean = true): WorktreesResult {
  const tErrors = useTranslations("ClientErrors");
  const url = enabled ? `/api/projects/${projectId}/worktrees` : null;
  const errorMessage = useCallback(() => tErrors("failedToReadWorktrees"), [tErrors]);
  const { data, loading, error, refresh: reload, updateData } = usePolledResource<WorktreeData>(
    url, null, errorMessage, { validateData: isWorktreeData },
  );
  const { run, pending: pruning, error: mutationError, clearError } = useScopedMutation(url);

  const prune = useCallback(async () => {
    if (!url || !data) return;
    await run(async () => {
      const response = await requestJson<WorktreeData>(url, {
        method: "POST", errorMessage: tErrors("failedToCleanWorktrees"), validateData: isWorktreeData,
      });
      if (response.error !== null) throw new Error(response.error);
      updateData(response.data);
      return true;
    }, tErrors("failedToCleanWorktrees"));
  }, [url, data, run, updateData, tErrors]);

  const refresh = useCallback(async () => { clearError(); await reload(); }, [clearError, reload]);

  return {
    worktrees: data?.worktrees ?? NO_WORKTREES,
    count: data?.count ?? null,
    orphanCount: data?.orphanCount ?? 0,
    loading, error: mutationError ?? error, refresh, prune, pruning,
  };
}
