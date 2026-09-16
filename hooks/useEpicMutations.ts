"use client";

import { useTranslations } from "next-intl";

import { useState, useRef, useCallback, useEffect } from "react";

interface UseEpicMutationsOptions {
  /** Called after a successful merge (before merging state resets). */
  onMergeSuccess?: () => void;
  /** Called after a successful delete (before deleting state resets). */
  onDeleteSuccess?: () => void;
}

/**
 * Owns the merge-into-main and permanent-delete mutations for an epic.
 * Fetch calls and their loading/error state live here; the component only
 * wires callbacks and renders the state.
 */
export function useEpicMutations(
  projectId: string,
  epicId: string | null,
  { onMergeSuccess, onDeleteSuccess }: UseEpicMutationsOptions = {}
) {
  const tErrors = useTranslations("ClientErrors");
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeConflict, setMergeConflict] = useState(false);
  const [conflictFiles, setConflictFiles] = useState<string[] | undefined>(undefined);
  const [deletingEpic, setDeletingEpic] = useState(false);
  const [deleteEpicError, setDeleteEpicError] = useState<string | null>(null);
  const inFlight = useRef<"merge" | "delete" | null>(null);
  const lifetime = useRef(0);
  useEffect(() => {
    lifetime.current += 1;
    inFlight.current = null;
    return () => { lifetime.current += 1; };
  }, [projectId, epicId]);

  const merge = useCallback(async () => {
    if (!epicId || inFlight.current) return;
    const requestLifetime = lifetime.current;
    inFlight.current = "merge";
    setMerging(true);
    setMergeError(null);
    setMergeConflict(false);
    setConflictFiles(undefined);
    const res = await fetch(`/api/projects/${projectId}/epics/${epicId}/merge`, {
      method: "POST",
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (lifetime.current !== requestLifetime) return;
    if (!res?.ok || data.error) {
      setMergeError(data.error || tErrors("failedToMerge"));
      setMergeConflict(data.reason === "conflict" || data.mergeFailed === true);
      if (Array.isArray(data.conflictFiles) && data.conflictFiles.length > 0) {
        setConflictFiles(data.conflictFiles);
      }
    } else {
      onMergeSuccess?.();
    }
    inFlight.current = null;
    setMerging(false);
  }, [projectId, epicId, onMergeSuccess, tErrors]);

  const deleteEpic = useCallback(async () => {
    if (!epicId || inFlight.current) return;
    const requestLifetime = lifetime.current;
    inFlight.current = "delete";
    setDeletingEpic(true);
    setDeleteEpicError(null);

    const res = await fetch(`/api/projects/${projectId}/epics/${epicId}`, {
      method: "DELETE",
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (lifetime.current !== requestLifetime) return;
    if (!res?.ok || data.error) {
      setDeleteEpicError(data.error || tErrors("failedToDeleteEpic"));
    } else {
      onDeleteSuccess?.();
    }
    inFlight.current = null;
    setDeletingEpic(false);
  }, [projectId, epicId, onDeleteSuccess, tErrors]);

  return {
    merging,
    mergeError,
    mergeConflict,
    conflictFiles,
    setMergeError,
    merge,
    deletingEpic,
    deleteEpicError,
    deleteEpic,
  };
}
