"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { usePolledResource } from "@/hooks/usePolledResource";
import type { ProjectEpicListRow } from "@/lib/types/kanban";

export type ProjectEpicSummary = Pick<
  ProjectEpicListRow,
  "id" | "title" | "readableId"
>;

/** Narrow index for ticket dependency links, retained while switching tickets. */
export function useProjectEpicsList(projectId: string, epicId: string | null, open: boolean) {
  const t = useTranslations("ClientErrors");
  const errorMessage = useCallback(() => t("networkErrorTheUpdateWasNotApplied"), [t]);
  const resource = usePolledResource<ProjectEpicSummary[]>(
    open && epicId ? `/api/projects/${projectId}/epics?view=index` : null, null, errorMessage,
  );
  return { epics: resource.data ?? [], error: resource.error };
}
