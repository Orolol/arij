"use client";

import { useState, useEffect } from "react";
import type { ProviderType } from "@/components/shared/ProviderSelect";

/**
 * Fetches the configured default provider for a given agent type and project.
 * Returns "claude-code" until the fetch completes or if no override is set.
 */
export function useDefaultProvider(
  agentType: string,
  projectId?: string
): ProviderType {
  const [provider, setProvider] = useState<ProviderType>("claude-code");

  useEffect(() => {
    const url = projectId
      ? `/api/projects/${projectId}/agent-config/providers/${agentType}`
      : `/api/agent-config/providers/${agentType}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (data.data?.provider) {
          setProvider(data.data.provider as ProviderType);
        }
      })
      .catch(() => {});
  }, [agentType, projectId]);

  return provider;
}
