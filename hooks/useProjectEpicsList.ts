"use client";

import { useState, useEffect } from "react";

export interface ProjectEpicSummary {
  id: string;
  title: string;
  status: string;
}

/**
 * Fetches the list of epics in a project (id/title/status) for dropdowns
 * such as the dependency editor. Only fetches while `open` is true and an
 * epic is selected; refetches when the selected epic changes.
 */
export function useProjectEpicsList(
  projectId: string,
  epicId: string | null,
  open: boolean
) {
  const [epics, setEpics] = useState<ProjectEpicSummary[]>([]);

  useEffect(() => {
    if (!open || !epicId) return;
    fetch(`/api/projects/${projectId}/epics`)
      .then((r) => r.json())
      .then((d) => {
        if (d.data) setEpics(d.data);
      })
      .catch(() => {});
  }, [projectId, epicId, open]);

  return { epics };
}
