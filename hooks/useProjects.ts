"use client";

import { useState, useEffect, useCallback } from "react";
import type { DashboardProject, ProjectFilter } from "@/lib/types/dashboard";

export function useProjects() {
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ProjectFilter>("all");

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      setProjects(data.data || []);
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const filtered = projects.filter((p) => {
    if (filter === "active") return p.status !== "archived";
    if (filter === "archived") return p.status === "archived";
    return true;
  });

  return {
    projects: filtered,
    allProjects: projects,
    loading,
    filter,
    setFilter,
    refresh: loadProjects,
  };
}
