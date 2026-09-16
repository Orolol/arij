"use client";
import { useTranslations } from "next-intl";
import { useScopedMutation } from "@/hooks/useScopedMutation";
import { requestJson } from "@/lib/api/client";
import type { ToastTone } from "@/components/toast/ToastStack";

export interface MergeBatchRow { projectId: string; epicId: string }
export function useMergeBatch(scope: string, onToast: (tone: ToastTone, message: string) => void, onChanged: () => void) {
  const t = useTranslations("Desk");
  const mutation = useScopedMutation(scope);
  const merge = async (rows: readonly MergeBatchRow[], resolveConflicts = false) => {
    await mutation.run(async () => {
      let merged = 0; let failed = 0; let agent = 0;
      for (const row of rows) {
        const base = `/api/projects/${row.projectId}/epics/${row.epicId}`;
        const result = await requestJson(`${base}/merge`, { method: "POST", errorMessage: t("toasts.mergeFailed") });
        if (!result.error) { merged++; continue; }
        if (resolveConflicts && result.code === "MERGE_CONFLICT") {
          const fix = await requestJson<{ resolved?: boolean; sessionId?: string }>(`${base}/resolve-merge`, { method: "POST", errorMessage: t("toasts.mergeFailed") });
          if (fix.data?.resolved) { merged++; continue; }
          if (fix.data?.sessionId) { agent++; continue; }
        }
        failed++;
      }
      if (merged) onToast("success", t("toasts.mergedCount", { count: merged }));
      if (agent) onToast("success", t("toasts.mergeFixAgentCount", { count: agent }));
      if (failed) onToast("error", t("toasts.mergesFailed", { count: failed }));
      onChanged();
      return true;
    }, t("toasts.mergeFailed"));
  };
  return { merge, pending: mutation.pending };
}
