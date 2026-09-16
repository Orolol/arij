"use client";
import { useCallback, useState } from "react";
import { useScopedMutation } from "@/hooks/useScopedMutation";
import { requestJson } from "@/lib/api/client";
export function useDocumentUploads({ projectId, onUploaded, uploadError }: {
  projectId: string; onUploaded: () => void; uploadError: (fileName: string, status?: number) => string;
}) {
  const mutation = useScopedMutation(projectId);
  const [failure, setFailure] = useState<{ projectId: string; error: string | null } | null>(null);
  const { run: mutationRun } = mutation;
  const upload = useCallback(async (files: FileList | readonly File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    const result = await mutationRun(async () => {
      let imported = 0; let error: string | null = null;
      for (const file of list) {
        const body = new FormData(); body.append("file", file);
        const response = await requestJson(`/api/projects/${projectId}/documents`, { method: "POST", body, errorMessage: (status) => uploadError(file.name, status) });
        if (response.error) { error = response.error; break; }
        imported++;
      }
      return { imported, error };
    }, uploadError(list[0].name));
    if (result) { setFailure({ projectId, error: result.error }); if (result.imported) onUploaded(); }
  }, [projectId, mutationRun, onUploaded, uploadError]);
  return { upload, uploading: mutation.pending, error: mutation.error ?? (failure?.projectId === projectId ? failure.error : null) };
}
