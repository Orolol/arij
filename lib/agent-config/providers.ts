import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentProviderDefaults, namedAgents } from "@/lib/db/schema";
import { AGENT_TYPES, type AgentProvider, type AgentType } from "./constants";

export type ProviderSource = "builtin" | "global" | "project";

export interface ResolvedAgentProvider {
  agentType: AgentType;
  provider: AgentProvider;
  source: ProviderSource;
  scope: string;
}

const FALLBACK_PROVIDER: AgentProvider = "claude-code";

function normalizeProvider(value: string | null | undefined): AgentProvider {
  if (value === "codex") return "codex";
  if (value === "gemini-cli") return "gemini-cli";
  return "claude-code";
}

export async function resolveAgentProvider(
  agentType: AgentType,
  projectId?: string
): Promise<AgentProvider> {
  if (projectId) {
    const projectDefault = db
      .select({ provider: agentProviderDefaults.provider })
      .from(agentProviderDefaults)
      .where(
        and(
          eq(agentProviderDefaults.agentType, agentType),
          eq(agentProviderDefaults.scope, projectId)
        )
      )
      .get();
    if (projectDefault?.provider) {
      return normalizeProvider(projectDefault.provider);
    }
  }

  const globalDefault = db
    .select({ provider: agentProviderDefaults.provider })
    .from(agentProviderDefaults)
    .where(
      and(
        eq(agentProviderDefaults.agentType, agentType),
        eq(agentProviderDefaults.scope, "global")
      )
    )
    .get();
  if (globalDefault?.provider) {
    return normalizeProvider(globalDefault.provider);
  }

  return FALLBACK_PROVIDER;
}

function mapProviderRowsByType(
  rows: Array<{ agentType: string; provider: string; scope: string }>
): Map<string, { provider: AgentProvider; scope: string }> {
  const map = new Map<string, { provider: AgentProvider; scope: string }>();
  for (const row of rows) {
    map.set(row.agentType, {
      provider: normalizeProvider(row.provider),
      scope: row.scope,
    });
  }
  return map;
}

export async function listGlobalAgentProviders(): Promise<ResolvedAgentProvider[]> {
  const rows = db
    .select({
      agentType: agentProviderDefaults.agentType,
      provider: agentProviderDefaults.provider,
      scope: agentProviderDefaults.scope,
    })
    .from(agentProviderDefaults)
    .where(eq(agentProviderDefaults.scope, "global"))
    .all();

  const providersByType = mapProviderRowsByType(rows);

  return AGENT_TYPES.map((agentType) => {
    const row = providersByType.get(agentType);
    if (row) {
      return {
        agentType,
        provider: row.provider,
        source: "global" as const,
        scope: "global",
      };
    }

    return {
      agentType,
      provider: FALLBACK_PROVIDER,
      source: "builtin" as const,
      scope: "global",
    };
  });
}

export async function listMergedProjectAgentProviders(
  projectId: string
): Promise<ResolvedAgentProvider[]> {
  const globalRows = db
    .select({
      agentType: agentProviderDefaults.agentType,
      provider: agentProviderDefaults.provider,
      scope: agentProviderDefaults.scope,
    })
    .from(agentProviderDefaults)
    .where(eq(agentProviderDefaults.scope, "global"))
    .all();

  const projectRows = db
    .select({
      agentType: agentProviderDefaults.agentType,
      provider: agentProviderDefaults.provider,
      scope: agentProviderDefaults.scope,
    })
    .from(agentProviderDefaults)
    .where(eq(agentProviderDefaults.scope, projectId))
    .all();

  const globalByType = mapProviderRowsByType(globalRows);
  const projectByType = mapProviderRowsByType(projectRows);

  return AGENT_TYPES.map((agentType) => {
    const projectRow = projectByType.get(agentType);
    if (projectRow) {
      return {
        agentType,
        provider: projectRow.provider,
        source: "project" as const,
        scope: projectId,
      };
    }

    const globalRow = globalByType.get(agentType);
    if (globalRow) {
      return {
        agentType,
        provider: globalRow.provider,
        source: "global" as const,
        scope: "global",
      };
    }

    return {
      agentType,
      provider: FALLBACK_PROVIDER,
      source: "builtin" as const,
      scope: "global",
    };
  });
}

// ---------------------------------------------------------------------------
// Named Agent Resolution
// ---------------------------------------------------------------------------

export interface ResolvedAgent {
  provider: AgentProvider;
  model?: string;
  name?: string;
}

/**
 * Resolves the named agent for a given task type by looking up the
 * agentProviderDefaults chain (project → global → builtin).
 *
 * When a namedAgentId is set, returns the named agent's provider, model, and name.
 * When namedAgentId is null, falls back to the raw provider column (no model override).
 */
export function resolveAgent(
  agentType: AgentType,
  projectId?: string,
): ResolvedAgent {
  // Try project-scoped default first
  if (projectId) {
    const row = db
      .select({
        provider: agentProviderDefaults.provider,
        namedAgentId: agentProviderDefaults.namedAgentId,
      })
      .from(agentProviderDefaults)
      .where(
        and(
          eq(agentProviderDefaults.agentType, agentType),
          eq(agentProviderDefaults.scope, projectId)
        )
      )
      .get();

    if (row) {
      const resolved = resolveFromRow(row);
      if (resolved) return resolved;
    }
  }

  // Try global default
  const globalRow = db
    .select({
      provider: agentProviderDefaults.provider,
      namedAgentId: agentProviderDefaults.namedAgentId,
    })
    .from(agentProviderDefaults)
    .where(
      and(
        eq(agentProviderDefaults.agentType, agentType),
        eq(agentProviderDefaults.scope, "global")
      )
    )
    .get();

  if (globalRow) {
    const resolved = resolveFromRow(globalRow);
    if (resolved) return resolved;
  }

  // Builtin fallback
  return { provider: FALLBACK_PROVIDER };
}

function resolveFromRow(row: {
  provider: string;
  namedAgentId: string | null;
}): ResolvedAgent | null {
  if (row.namedAgentId) {
    const agent = db
      .select()
      .from(namedAgents)
      .where(eq(namedAgents.id, row.namedAgentId))
      .get();

    if (agent) {
      return {
        provider: normalizeProvider(agent.provider),
        model: agent.model,
        name: agent.name,
      };
    }
  }

  // namedAgentId is null or agent was deleted — use raw provider
  return {
    provider: normalizeProvider(row.provider),
  };
}
