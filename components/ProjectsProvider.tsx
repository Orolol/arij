"use client";
import { ProjectsContextProvider, useSharedProjectsResource } from "@/hooks/useProjects";
export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const value = useSharedProjectsResource();
  return <ProjectsContextProvider value={value}>{children}</ProjectsContextProvider>;
}
