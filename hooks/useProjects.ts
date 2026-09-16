"use client";

import { useTranslations } from "next-intl";

import type { DashboardProject, ProjectFilter } from "@/lib/types/dashboard";
import { createContext, useCallback, useContext, useState } from "react";
import { usePolledResource } from "./usePolledResource";

const NO_PROJECTS: DashboardProject[] = [];
const isProjectList = (value: unknown): value is DashboardProject[] => Array.isArray(value);

function useProjectsResource(enabled = true) {
  const tErrors = useTranslations("ClientErrors");
  const errorMessage = useCallback((status?: number) => status
    ? tErrors("projectsHttp", { status })
    : tErrors("failedToLoadProjects"), [tErrors]);
  const { data, loading, error, refresh } = usePolledResource<DashboardProject[]>(
    enabled ? "/api/projects" : null, 10000, errorMessage, { validateData: isProjectList },
  );
  return { projects: data ?? NO_PROJECTS, loading, error, refresh };
}

const ProjectsContext = createContext<ReturnType<typeof useProjectsResource> | null>(null);
export const ProjectsContextProvider = ProjectsContext.Provider;
export function useSharedProjectsResource() { return useProjectsResource(); }

export function useProjects(enabled = true) {
  const shared = useContext(ProjectsContext);
  const fallback = useProjectsResource(!shared && enabled);
  const { projects, loading, error, refresh } = shared ?? fallback;
  const [filter, setFilter] = useState<ProjectFilter>("all");
  return { projects: projects.filter((p) => filter === "all" || (filter === "active" ? p.status !== "archived" : p.status === "archived")),
    allProjects: projects, loading, error, refresh, filter, setFilter };
}
