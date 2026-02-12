import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentPrompts } from "@/lib/db/schema";
import {
  AGENT_TYPES,
  BUILTIN_AGENT_PROMPTS,
  type AgentType,
} from "./constants";

export type PromptSource = "builtin" | "global" | "project";

export interface ResolvedAgentPrompt {
  agentType: AgentType;
  systemPrompt: string;
  source: PromptSource;
  scope: string;
}

function mapRowsByAgentType(
  rows: Array<{
    agentType: string;
    systemPrompt: string;
    scope: string;
  }>
): Map<string, { systemPrompt: string; scope: string }> {
  const map = new Map<string, { systemPrompt: string; scope: string }>();
  for (const row of rows) {
    map.set(row.agentType, {
      systemPrompt: row.systemPrompt,
      scope: row.scope,
    });
  }
  return map;
}

export async function resolveAgentPrompt(
  agentType: AgentType,
  projectId?: string
): Promise<string> {
  if (projectId) {
    const projectOverride = db
      .select({
        systemPrompt: agentPrompts.systemPrompt,
      })
      .from(agentPrompts)
      .where(
        and(
          eq(agentPrompts.agentType, agentType),
          eq(agentPrompts.scope, projectId)
        )
      )
      .get();
    if (projectOverride?.systemPrompt != null) {
      return projectOverride.systemPrompt;
    }
  }

  const globalPrompt = db
    .select({
      systemPrompt: agentPrompts.systemPrompt,
    })
    .from(agentPrompts)
    .where(
      and(eq(agentPrompts.agentType, agentType), eq(agentPrompts.scope, "global"))
    )
    .get();

  if (globalPrompt?.systemPrompt != null) {
    return globalPrompt.systemPrompt;
  }

  return BUILTIN_AGENT_PROMPTS[agentType];
}

export async function listGlobalAgentPrompts(): Promise<ResolvedAgentPrompt[]> {
  const globalRows = db
    .select({
      agentType: agentPrompts.agentType,
      systemPrompt: agentPrompts.systemPrompt,
      scope: agentPrompts.scope,
    })
    .from(agentPrompts)
    .where(eq(agentPrompts.scope, "global"))
    .all();

  const globalByType = mapRowsByAgentType(globalRows);

  return AGENT_TYPES.map((agentType) => {
    const row = globalByType.get(agentType);
    if (row) {
      return {
        agentType,
        systemPrompt: row.systemPrompt,
        source: "global" as const,
        scope: "global",
      };
    }

    return {
      agentType,
      systemPrompt: BUILTIN_AGENT_PROMPTS[agentType],
      source: "builtin" as const,
      scope: "global",
    };
  });
}

export async function listMergedProjectAgentPrompts(
  projectId: string
): Promise<ResolvedAgentPrompt[]> {
  const globalRows = db
    .select({
      agentType: agentPrompts.agentType,
      systemPrompt: agentPrompts.systemPrompt,
      scope: agentPrompts.scope,
    })
    .from(agentPrompts)
    .where(eq(agentPrompts.scope, "global"))
    .all();

  const projectRows = db
    .select({
      agentType: agentPrompts.agentType,
      systemPrompt: agentPrompts.systemPrompt,
      scope: agentPrompts.scope,
    })
    .from(agentPrompts)
    .where(eq(agentPrompts.scope, projectId))
    .all();

  const globalByType = mapRowsByAgentType(globalRows);
  const projectByType = mapRowsByAgentType(projectRows);

  return AGENT_TYPES.map((agentType) => {
    const projectRow = projectByType.get(agentType);
    if (projectRow) {
      return {
        agentType,
        systemPrompt: projectRow.systemPrompt,
        source: "project" as const,
        scope: projectId,
      };
    }

    const globalRow = globalByType.get(agentType);
    if (globalRow) {
      return {
        agentType,
        systemPrompt: globalRow.systemPrompt,
        source: "global" as const,
        scope: "global",
      };
    }

    return {
      agentType,
      systemPrompt: BUILTIN_AGENT_PROMPTS[agentType],
      source: "builtin" as const,
      scope: "global",
    };
  });
}
