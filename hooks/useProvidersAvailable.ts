"use client";

import { useEffect, useState } from "react";
import type { AgentProvider } from "@/lib/agent-config/constants";
import { PROVIDER_OPTIONS } from "@/lib/agent-config/constants";

export interface ProvidersAvailability {
  /** Per-provider availability map, one entry per PROVIDER_OPTIONS value. */
  providers: Record<AgentProvider, boolean>;
  loading: boolean;
}

const DEFAULT_PROVIDERS = Object.fromEntries(
  PROVIDER_OPTIONS.map((provider) => [provider, false]),
) as Record<AgentProvider, boolean>;

/**
 * Checks availability of all CLI providers.
 */
export function useProvidersAvailable(): ProvidersAvailability {
  const [providers, setProviders] = useState<Record<AgentProvider, boolean>>({
    ...DEFAULT_PROVIDERS,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/providers/available")
      .then((r) => r.json())
      .then((d) => {
        const data = d.data ?? {};
        setProviders(Object.fromEntries(
          PROVIDER_OPTIONS.map((provider) => [provider, !!data[provider]]),
        ) as Record<AgentProvider, boolean>);
      })
      .catch(() => {
        setProviders({ ...DEFAULT_PROVIDERS });
      })
      .finally(() => setLoading(false));
  }, []);

  return { providers, loading };
}
