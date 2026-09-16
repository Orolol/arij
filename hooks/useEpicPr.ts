"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { requestJson } from "@/lib/api/client";
import { usePolledResource } from "@/hooks/usePolledResource";
import { useScopedMutation } from "@/hooks/useScopedMutation";

interface PrData {
  id: string;
  projectId: string;
  epicId: string | null;
  number: number;
  url: string;
  title: string;
  status: "draft" | "open" | "closed" | "merged";
  headBranch: string;
  baseBranch: string;
  createdAt: string | null;
  updatedAt: string | null;
}

function isPr(value: unknown): value is PrData {
  return Boolean(value && typeof value === "object" && "id" in value
    && typeof value.id === "string" && "number" in value && typeof value.number === "number");
}
const isOptionalPr = (value: unknown): value is PrData | null => value === null || isPr(value);
const isCreatedPr = (value: unknown): value is { pr: PrData } =>
  Boolean(value && typeof value === "object" && "pr" in value && isPr(value.pr));

export function useEpicPr(projectId: string, epicId: string | null) {
  const tErrors = useTranslations("ClientErrors");
  const url = epicId ? `/api/projects/${projectId}/epics/${epicId}/pr` : null;
  const errorMessage = useCallback(() => tErrors("failedToLoadPR"), [tErrors]);
  const { data: pr, loading, error, refresh: reload, updateData } = usePolledResource<PrData | null>(
    url, null, errorMessage, { validateData: isOptionalPr },
  );
  const { run, pending, error: mutationError, clearError } = useScopedMutation(url);
  const ready = Boolean(url) && !loading && !error;

  const createPr = useCallback(async (opts?: { baseBranch?: string; draft?: boolean }) => {
    if (!url || !ready || pr) return false;
    return Boolean(await run(async () => {
      const response = await requestJson<{ pr: PrData }>(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        // Omit an unspecified base: the server resolves the project's default.
        body: JSON.stringify({ baseBranch: opts?.baseBranch, draft: opts?.draft ?? false }),
        errorMessage: tErrors("failedToCreatePR"), validateData: isCreatedPr,
      });
      if (response.error !== null) throw new Error(response.error);
      updateData(response.data.pr);
      return true;
    }, tErrors("failedToCreatePR")));
  }, [url, ready, pr, run, updateData, tErrors]);

  const syncPr = useCallback(async () => {
    if (!url || !ready || !pr) return false;
    return Boolean(await run(async () => {
      const response = await requestJson<PrData>(`${url}/sync`, {
        method: "POST", errorMessage: tErrors("failedToSyncPR"), validateData: isPr,
      });
      if (response.error !== null) throw new Error(response.error);
      updateData(response.data);
      return true;
    }, tErrors("failedToSyncPR")));
  }, [url, ready, pr, run, updateData, tErrors]);

  const refresh = useCallback(async () => { clearError(); await reload(); }, [clearError, reload]);
  return { pr, loading: loading || pending, ready, error: mutationError ?? error, createPr, syncPr, refresh };
}
