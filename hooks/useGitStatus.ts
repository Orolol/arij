"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { requestJson } from "@/lib/api/client";
import { usePolledResource } from "@/hooks/usePolledResource";
import { useScopedMutation } from "@/hooks/useScopedMutation";

interface GitStatus {
  ahead: number;
  behind: number;
  lastFetchedAt: number | null;
  lastFetchError: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  push: () => Promise<void>;
  pushing: boolean;
}

interface StatusData {
  ahead: number;
  behind: number;
  lastFetchedAt?: number | null;
  lastFetchError?: string | null;
}
function isStatus(value: unknown): value is StatusData {
  if (!value || typeof value !== "object") return false;
  const data = value as StatusData;
  return Number.isInteger(data.ahead) && data.ahead >= 0 && Number.isInteger(data.behind) && data.behind >= 0;
}

/** Ahead/behind for a local branch, only while a repository and branch exist. */
export function useGitStatus(projectId: string, branchName: string | null, enabled: boolean): GitStatus {
  const tErrors = useTranslations("ClientErrors");
  const url = branchName && enabled
    ? `/api/projects/${projectId}/git/status?branch=${encodeURIComponent(branchName)}` : null;
  const errorMessage = useCallback((status?: number) =>
    status ? tErrors("failedToFetchStatus") : tErrors("failedToFetchGitStatus"), [tErrors]);
  const { data, loading, error, refresh: reload } = usePolledResource<StatusData>(
    url, null, errorMessage, { validateData: isStatus },
  );
  const { run, pending: pushing, error: mutationError, clearError } = useScopedMutation(url);

  const push = useCallback(async () => {
    if (!url || !data) return;
    await run(async () => {
      const response = await requestJson<unknown>(`/api/projects/${projectId}/git/push`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: branchName }), errorMessage: tErrors("pushFailed"),
      });
      if (response.error !== null) throw new Error(response.error);
      // Refresh invalidates reads made before the push, including manual fetches
      // that may still be pending. A callback from an old branch is inert.
      await reload();
      return true;
    }, tErrors("pushFailed"));
  }, [url, data, projectId, branchName, run, reload, tErrors]);

  const refresh = useCallback(async () => { clearError(); await reload(); }, [clearError, reload]);
  return {
    ahead: data?.ahead ?? 0, behind: data?.behind ?? 0,
    lastFetchedAt: data?.lastFetchedAt ?? null, lastFetchError: data?.lastFetchError ?? null,
    loading, error: mutationError ?? error, refresh, push, pushing,
  };
}
