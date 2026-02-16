"use client";

import { useState, useEffect, useCallback } from "react";
import type { FileDiff } from "@/lib/git/diff";

export function useDiff(projectId: string, epicId: string | null) {
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiff = useCallback(async () => {
    if (!epicId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/epics/${epicId}/diff`
      );
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        setFiles([]);
      } else {
        setFiles(data.data?.files || []);
      }
    } catch {
      setError("Failed to load diff");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, epicId]);

  useEffect(() => {
    fetchDiff();
  }, [fetchDiff]);

  return { files, loading, error, refresh: fetchDiff };
}
