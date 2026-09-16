"use client";
import { useCallback } from "react";
import { useProjects } from "./useProjects";
import { usePolledResource } from "./usePolledResource";

const configError = () => "GitHub configuration is unavailable";
const isConfig = (value: unknown): value is { tokenSet: boolean } => typeof value === "object" && value !== null && "tokenSet" in value && typeof value.tokenSet === "boolean";
export function useGitHubConfig(projectId: string | undefined) {
  const { allProjects, loading, error, refresh: refreshProjects } = useProjects(Boolean(projectId));
  const config = usePolledResource<{ tokenSet: boolean }>(projectId ? "/api/github/config" : null, null, configError, { validateData: isConfig });
  const ownerRepo = allProjects.find((project) => project.id === projectId)?.githubOwnerRepo ?? null;
  const refreshConfig = config.refresh;
  const refresh = useCallback(() => { void refreshProjects(); void refreshConfig(); }, [refreshProjects, refreshConfig]);
  const tokenSet = config.data?.tokenSet === true;
  return { ownerRepo, tokenSet, isConfigured: Boolean(ownerRepo && tokenSet), loading: loading || config.loading, error: Boolean(error || config.error), refresh };
}
