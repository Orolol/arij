"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { requestJson } from "@/lib/api/client";
import { usePolledResource } from "@/hooks/usePolledResource";
import { useScopedMutation } from "@/hooks/useScopedMutation";

export interface DependencyRecord {
  id: string;
  ticketId: string;
  dependsOnTicketId: string;
  projectId: string;
  scopeType: string;
  scopeId: string;
  createdAt: string;
}

export interface EpicDependencyData {
  predecessors: DependencyRecord[];
  successors: DependencyRecord[];
}

const NO_DEPENDENCIES: DependencyRecord[] = [];
function isDependencyData(value: unknown): value is EpicDependencyData {
  if (!value || typeof value !== "object") return false;
  const data = value as EpicDependencyData;
  return Array.isArray(data.predecessors) && Array.isArray(data.successors);
}
const isDependencies = (value: unknown): value is DependencyRecord[] => Array.isArray(value);

export function useEpicDependencies(projectId: string, epicId: string | null) {
  const tErrors = useTranslations("ClientErrors");
  const url = epicId ? `/api/projects/${projectId}/epics/${epicId}/dependencies` : null;
  const errorMessage = useCallback(() => tErrors("failedToLoadDependencies"), [tErrors]);
  const { data, loading, error, refresh: reload, updateData } = usePolledResource<EpicDependencyData>(
    url, null, errorMessage, { validateData: isDependencyData },
  );
  const { run, pending: saving, error: mutationError, clearError } = useScopedMutation(url);

  const saveDependencies = useCallback(async (dependsOnIds: string[]) => {
    if (!url || !data) return false;
    return Boolean(await run(async () => {
      const response = await requestJson<DependencyRecord[]>(url, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dependsOnIds }), errorMessage: tErrors("failedToUpdateDependencies"),
        validateData: isDependencies,
      });
      if (response.error !== null) throw new Error(response.error);
      // PUT returns the canonical predecessor records. Preserve the unrelated
      // successors and invalidate any GET issued before this confirmed write.
      updateData((current) => ({
        predecessors: response.data,
        successors: current?.successors ?? NO_DEPENDENCIES,
      }));
      return true;
    }, tErrors("failedToUpdateDependencies")));
  }, [url, data, run, updateData, tErrors]);

  const refresh = useCallback(async () => { clearError(); await reload(); }, [clearError, reload]);

  return {
    predecessors: data?.predecessors ?? NO_DEPENDENCIES,
    successors: data?.successors ?? NO_DEPENDENCIES,
    loading, saving, ready: data !== null, error: mutationError ?? error,
    saveDependencies, refresh, clearError,
  };
}
