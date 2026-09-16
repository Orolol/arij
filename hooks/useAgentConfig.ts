"use client";

import { usePolledResource } from "@/hooks/usePolledResource";

import { useTranslations } from "next-intl";

import { usePolling } from "@/hooks/usePolling";
import type { AgentProvider, AgentType } from "@/lib/agent-config/constants";
import type { NamedAgentCliOptions } from "@/lib/providers/options-registry";
import { useCallback, useEffect, useState } from "react";
// Payload shapes owned by the server modules. `import type` only: these
// modules reach `lib/db`, and a type-only import is erased before bundling.
import type {
AgentDaySeriesPoint,
AgentDayStats,
NamedAgentStats,
} from "@/lib/agent-config/agent-stats";
import type { ResolvedAgentPrompt } from "@/lib/agent-config/prompts";

export type { AgentDaySeriesPoint, AgentDayStats, NamedAgentStats, ResolvedAgentPrompt };

type AssignmentSource = "builtin" | "global" | "project";

export interface ResolvedAgentAssignment {
  agentType: AgentType;
  provider: AgentProvider;
  namedAgentId: string | null;
  source: AssignmentSource;
  scope: string;
  namedAgent?: {
    id: string;
    name: string;
    /** A composite carries the sentinel here; branch on `kind` first. */
    provider: AgentProvider;
    model: string;
    kind?: "simple" | "composite";
  } | null;
}

const EMPTY_LIST: never[] = [];

const listError = () => "Unable to load agent configuration";
const isList = <T,>(value: unknown): value is T[] => Array.isArray(value);
function useKeyedList<T>(url: string | null) {
  const resource = usePolledResource<T[]>(url, null, listError, { validateData: isList<T> });
  return { ...resource, data: resource.data ?? EMPTY_LIST, error: url === null || Boolean(resource.error), refresh: resource.reload };
}

function buildUrl(
  basePath: string,
  scope: "global" | "project",
  projectId?: string
): string | null {
  if (scope === "project") {
    return projectId ? `/api/projects/${projectId}${basePath}` : null;
  }
  return `/api${basePath}`;
}

export function useAgentPrompts(
  scope: "global" | "project",
  projectId?: string
) {
  const url = buildUrl("/agent-config/prompts", scope, projectId);
  const { data, loading, error, refresh: load } = useKeyedList<ResolvedAgentPrompt>(url);

  const updatePrompt = useCallback(
    async (agentType: AgentType, systemPrompt: string) => {
      const url = buildUrl(
        `/agent-config/prompts/${agentType}`,
        scope,
        projectId
      );
      if (!url) return false;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt }),
      });
      return res.ok && Boolean(await load());
    },
    [scope, projectId, load]
  );

  const resetPrompt = useCallback(
    async (agentType: AgentType) => {
      const url =
        scope === "project" && projectId
          ? `/api/projects/${projectId}/agent-config/prompts/${agentType}`
          : `/api/agent-config/prompts/${agentType}`;
      const res = await fetch(url, { method: "DELETE" });
      return res.ok && Boolean(await load());
    },
    [scope, projectId, load]
  );

  return { data, loading, error, refresh: load, updatePrompt, resetPrompt };
}

export function useAgentAssignments(
  scope: "global" | "project",
  projectId?: string
) {
  const tErrors = useTranslations("ClientErrors");
  const url = buildUrl("/agent-config/providers", scope, projectId);
  const { data, loading, error, refresh: load } = useKeyedList<ResolvedAgentAssignment>(url);

  const assignAgent = useCallback(
    async (agentType: AgentType, namedAgentId: string | null) => {
      const url = buildUrl(
        `/agent-config/providers/${agentType}`,
        scope,
        projectId
      );
      if (!url) return { ok: false, error: tErrors("couldNotUpdateThisAssignment") };
      const res = await fetch(url, {
        method: namedAgentId ? "PUT" : "DELETE",
        headers: namedAgentId
          ? { "Content-Type": "application/json" }
          : undefined,
        body: namedAgentId ? JSON.stringify({ namedAgentId }) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) await load();
      return {
        ok: res.ok,
        error:
          typeof json.error === "string"
            ? json.error
            : res.ok
              ? undefined
              : tErrors("couldNotUpdateThisAssignment"),
      };
    },
    [scope, projectId, load, tErrors]
  );

  return { data, loading, error, refresh: load, assignAgent };
}

// ---------------------------------------------------------------------------
// Named Agents
// ---------------------------------------------------------------------------

/** One member of a composite agent, in rank order. */
export interface CompositeMember {
  id: string;
  name: string;
  provider: AgentProvider;
  model: string;
  position: number;
}

export interface NamedAgent {
  id: string;
  name: string;
  provider: AgentProvider;
  model: string;
  /** Non-default per-CLI options only; `{}` means "all CLI defaults". */
  options: NamedAgentCliOptions;
  /** Persona injected at the head of the prompt; null injects nothing. */
  personaPrompt: string | null;
  /**
   * `'simple'` or `'composite'`. A composite is an ORDERED FALLBACK LIST of
   * simple agents: attempt N of a pipeline stage runs member N-1, and the
   * length of the list is the attempt budget.
   */
  kind: "simple" | "composite";
  /** Populated for a composite; empty for a simple agent. */
  members: CompositeMember[];
  /** True for the one composite designated as the default agent. */
  isDefault: boolean;
  createdAt: string | null;
}

export function useNamedAgents() {
  const t = useTranslations("AgentsWorkshop");
  const reloadFailed = t("common.loadFailed");
  const { data, loading, error, refresh: load } = useKeyedList<NamedAgent>(
    "/api/agent-config/named-agents"
  );

  const createNamedAgent = useCallback(
    async (input: {
      name: string;
      provider: AgentProvider;
      model?: string;
      options?: NamedAgentCliOptions;
      personaPrompt?: string | null;
    }) => {
      const res = await fetch("/api/agent-config/named-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (res.ok) await load();
      const json = await res.json();
      return { ok: res.ok, error: json.error };
    },
    [load],
  );

  const updateNamedAgent = useCallback(
    async (
      id: string,
      updates: {
        name?: string;
        provider?: AgentProvider;
        model?: string;
        options?: NamedAgentCliOptions;
        personaPrompt?: string | null;
        /** Composite only — the new ordered member list. */
        memberIds?: string[];
      },
    ) => {
      const res = await fetch(`/api/agent-config/named-agents/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (!res.ok) return { ok: false, error: json.error };
      const reloaded = await load();
      // The editor drops its draft only after the canonical saved row lands.
      return { ok: reloaded, error: reloaded ? undefined : reloadFailed };
    },
    [load, reloadFailed],
  );

  const deleteNamedAgent = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/agent-config/named-agents/${id}`, {
        method: "DELETE",
      });
      if (res.ok) await load();
      return res.ok;
    },
    [load],
  );

  /**
   * Creates a COMPOSITE. Separate from `createNamedAgent` because the two
   * bodies share only the name: a composite carries an ordered member list
   * and no CLI, model, options or persona at all.
   */
  const createCompositeAgent = useCallback(
    async (input: { name: string; memberIds: string[] }) => {
      const res = await fetch("/api/agent-config/named-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, kind: "composite" }),
      });
      if (res.ok) await load();
      const json = await res.json();
      return { ok: res.ok, error: json.error };
    },
    [load],
  );

  /**
   * Designates the composite that answers "Default agent", or clears the
   * designation with `null`. Reloads the roster because `isDefault` travels
   * on the agent rows themselves.
   */
  const setDefaultCompositeAgent = useCallback(
    async (compositeAgentId: string | null) => {
      const res = await fetch("/api/agent-config/default-composite", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compositeAgentId }),
      });
      if (res.ok) await load();
      const json = await res.json();
      return { ok: res.ok, error: json.error };
    },
    [load],
  );

  return {
    data,
    loading,
    error,
    refresh: load,
    createNamedAgent,
    createCompositeAgent,
    updateNamedAgent,
    deleteNamedAgent,
    setDefaultCompositeAgent,
  };
}

// ---------------------------------------------------------------------------
// Named-agent statistics (the /agents workshop)
// ---------------------------------------------------------------------------

/**
 * Whether the roster aggregate is usable at all.
 *
 * Three states, not two, because the card's figures mean three different
 * things and a boolean cannot tell the middle one from the last:
 *
 *   - `loading`     — nothing has come back yet. Em-dashes.
 *   - `unavailable` — the last attempt failed. Em-dashes; a `0` here would be
 *                     a number the server never said.
 *   - `ready`       — the aggregate answered. An agent MISSING from it really
 *                     has no runs today, so its card shows a truthful `0`.
 */
export type AgentRosterStatsStatus = "loading" | "ready" | "unavailable";

/**
 * Today's numbers for EVERY named agent, from one request.
 *
 * The roster renders a card per agent; fetching per card would be an N+1 over
 * the largest table in the database. The route answers every agent in a single
 * query, keyed here by agent id for O(1) lookup at render time.
 *
 * Polled at 10s (the dashboard cadence) so the live dots and today's counters
 * move without a reload. Do not poll faster: this is a five-column aggregate
 * over the session table.
 *
 * A FAILED POLL CLEARS THE DATA. Every rejection path — a transport error, a
 * non-2xx (the route answers 500 with `{ error }`, which parses perfectly
 * happily and would otherwise read as "no agents ran today"), or a payload
 * without the expected array — lands on `unavailable` with an EMPTY map. That
 * is the only shape in which "we do not know" reaches the card: keeping the
 * previous poll's rows would leave a live dot breathing next to numbers no
 * server currently vouches for.
 */
/**
 * The aggregate, or a throw. Kept out of the hook because a `throw` inside a
 * `try` is one of the constructs the React Compiler stops on — and stopping
 * there left `useAgentRosterStats` unread by every compiler rule.
 */
async function readRosterStats(): Promise<Record<string, AgentDayStats>> {
  const res = await fetch("/api/agent-config/named-agents/all/stats");
  if (!res.ok) throw new Error(`Roster stats responded ${res.status}`);
  const json = await res.json();
  const rows: unknown = json?.data?.agents;
  if (!Array.isArray(rows)) {
    throw new Error("Roster stats payload carries no agents array");
  }
  const next: Record<string, AgentDayStats> = {};
  for (const row of rows as AgentDayStats[]) next[row.namedAgentId] = row;
  return next;
}

export function useAgentRosterStats(): {
  data: Record<string, AgentDayStats>;
  status: AgentRosterStatsStatus;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<Record<string, AgentDayStats>>({});
  const [status, setStatus] = useState<AgentRosterStatsStatus>("loading");

  const load = useCallback(async () => {
    try {
      setData(await readRosterStats());
      setStatus("ready");
    } catch {
      // A missing aggregate collapses the card figures to em-dashes; it must
      // never take the roster down with it.
      setData({});
      setStatus("unavailable");
    }
  }, []);

  usePolling(load, 10_000);

  return { data, status, refresh: load };
}

/**
 * The selected agent's 14-day aggregate.
 *
 * CANCELLED-FETCH DISCIPLINE: this re-fetches on every roster click. Without
 * the `cancelled` flag, clicking three agents quickly paints whichever
 * response happens to land last — which is the slowest one, not the one the
 * user is looking at.
 */
export function useNamedAgentStats(agentId: string | null): {
  data: NamedAgentStats | null;
  loading: boolean;
} {
  // The payload is STAMPED with the agent it describes, and read back only
  // when the stamp still matches. That serves two purposes at once: the
  // previous agent's numbers never flash under the newly selected name, and
  // `loading` is a derivation rather than a setState the effect has to make
  // synchronously on every change of selection.
  const [entry, setEntry] = useState<{
    agentId: string;
    data: NamedAgentStats | null;
  } | null>(null);

  useEffect(() => {
    if (!agentId) return;

    let cancelled = false;
    fetch(`/api/agent-config/named-agents/${agentId}/stats`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setEntry({ agentId, data: json?.data ?? null });
      })
      .catch(() => {
        if (cancelled) return;
        setEntry({ agentId, data: null });
      });

    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const fresh = agentId !== null && entry?.agentId === agentId;
  return { data: fresh ? entry.data : null, loading: agentId !== null && !fresh };
}
