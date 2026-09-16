"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { usePolledResource } from "@/hooks/usePolledResource";
import type { FileDiff, DiffMetadata } from "@/lib/git/diff";

interface DiffData {
  files: FileDiff[];
  metadata?: DiffMetadata | null;
}

const NO_FILES: FileDiff[] = [];
function isDiff(value: unknown): value is DiffData {
  return Boolean(value && typeof value === "object" && "files" in value && Array.isArray(value.files));
}

export function useDiff(projectId: string, epicId: string | null) {
  const tErrors = useTranslations("ClientErrors");
  const errorMessage = useCallback(() => tErrors("failedToLoadDiff"), [tErrors]);
  const { data, loading, error, refresh } = usePolledResource<DiffData>(
    epicId ? `/api/projects/${projectId}/epics/${epicId}/diff` : null,
    null,
    errorMessage,
    { validateData: isDiff },
  );
  return { files: data?.files ?? NO_FILES, metadata: data?.metadata ?? null, loading, error, refresh };
}
