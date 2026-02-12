"use client";

import { useState, useEffect, useCallback } from "react";
import type { AgentType, ProviderOption } from "@/lib/types/agent-config";

// --- Types ---

export interface AgentPromptEntry {
  agentType: AgentType;
  label: string;
  systemPrompt: string | null;
  isCustom: boolean;
  updatedAt: string | null;
  // project-scoped fields (optional)
  source?: "project" | "global" | "default";
  globalPrompt?: string | null;
  projectPrompt?: string | null;
}

export interface CustomReviewAgent {
  id: string;
  name: string;
  systemPrompt: string;
  scope: string;
  position: number | null;
  isEnabled: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProviderDefaultEntry {
  agentType: AgentType;
  label: string;
  provider: ProviderOption;
  isCustom?: boolean;
  source?: "project" | "global" | "default";
  updatedAt?: string | null;
}

// --- Hook ---

export function useAgentConfig(projectId?: string) {
  const [prompts, setPrompts] = useState<AgentPromptEntry[]>([]);
  const [reviewAgents, setReviewAgents] = useState<CustomReviewAgent[]>([]);
  const [providers, setProviders] = useState<ProviderDefaultEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const base = projectId
        ? `/api/projects/${projectId}/agent-config`
        : "/api/agent-config";

      const [promptsRes, agentsRes, providersRes] = await Promise.all([
        fetch(`${base}/prompts`),
        fetch(`${base}/review-agents`),
        fetch(`${base}/providers`),
      ]);

      const [promptsData, agentsData, providersData] = await Promise.all([
        promptsRes.json(),
        agentsRes.json(),
        providersRes.json(),
      ]);

      if (promptsData.data) setPrompts(promptsData.data);
      if (agentsData.data) setReviewAgents(agentsData.data);
      if (providersData.data) setProviders(providersData.data);
    } catch (err) {
      console.error("Failed to fetch agent config:", err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // --- Prompts ---

  const savePrompt = useCallback(
    async (agentType: AgentType, systemPrompt: string) => {
      const url = projectId
        ? `/api/projects/${projectId}/agent-config/prompts/${agentType}`
        : `/api/agent-config/prompts/${agentType}`;

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt }),
      });
      if (!res.ok) throw new Error("Failed to save prompt");
      await fetchAll();
    },
    [projectId, fetchAll]
  );

  const deleteProjectPrompt = useCallback(
    async (agentType: AgentType) => {
      if (!projectId) return;
      const res = await fetch(
        `/api/projects/${projectId}/agent-config/prompts/${agentType}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete project prompt");
      await fetchAll();
    },
    [projectId, fetchAll]
  );

  // --- Review Agents ---

  const createReviewAgent = useCallback(
    async (name: string, systemPrompt: string) => {
      const url = projectId
        ? `/api/projects/${projectId}/agent-config/review-agents`
        : "/api/agent-config/review-agents";

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, systemPrompt }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to create review agent");
      }
      await fetchAll();
    },
    [projectId, fetchAll]
  );

  const updateReviewAgent = useCallback(
    async (
      agentId: string,
      updates: { name?: string; systemPrompt?: string; isEnabled?: boolean }
    ) => {
      const res = await fetch(`/api/agent-config/review-agents/${agentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to update review agent");
      }
      await fetchAll();
    },
    [fetchAll]
  );

  const deleteReviewAgent = useCallback(
    async (agentId: string) => {
      const res = await fetch(`/api/agent-config/review-agents/${agentId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete review agent");
      await fetchAll();
    },
    [fetchAll]
  );

  // --- Providers ---

  const saveProvider = useCallback(
    async (agentType: AgentType, provider: ProviderOption) => {
      const url = projectId
        ? `/api/projects/${projectId}/agent-config/providers/${agentType}`
        : `/api/agent-config/providers/${agentType}`;

      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (!res.ok) throw new Error("Failed to save provider default");
      await fetchAll();
    },
    [projectId, fetchAll]
  );

  return {
    prompts,
    reviewAgents,
    providers,
    loading,
    refresh: fetchAll,
    savePrompt,
    deleteProjectPrompt,
    createReviewAgent,
    updateReviewAgent,
    deleteReviewAgent,
    saveProvider,
  };
}
