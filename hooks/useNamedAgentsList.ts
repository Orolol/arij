"use client";

import { useNamedAgents, type NamedAgent } from "@/hooks/useAgentConfig";

/**
 * Shape of a named-agent option as consumed by pickers (NamedAgentSelect,
 * git-sync, releases). Alias of the canonical NamedAgent type so the
 * endpoint payload shape is defined once in hooks/useAgentConfig.ts.
 */
export type NamedAgentOption = NamedAgent;

/**
 * Read-only list of named agents. Delegates to useNamedAgents (the full
 * CRUD hook) so the fetch endpoint and shape live in one place.
 */
export function useNamedAgentsList() {
  const { data: agents, loading, refresh } = useNamedAgents();
  return { agents, loading, refresh };
}
