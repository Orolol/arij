import { and, eq, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customReviewAgents } from "@/lib/db/schema";

export interface CustomReviewAgentRecord {
  id: string;
  name: string;
  systemPrompt: string;
  scope: string;
  position: number;
  isEnabled: number;
  createdAt: string | null;
  updatedAt: string | null;
  source?: "global" | "project";
}

function normalizeIsEnabled(value: boolean | number | undefined): number | undefined {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "number") {
    return value === 0 ? 0 : 1;
  }
  return undefined;
}

export async function listGlobalCustomReviewAgents(): Promise<CustomReviewAgentRecord[]> {
  return db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.scope, "global"))
    .orderBy(customReviewAgents.position, customReviewAgents.createdAt)
    .all();
}

export async function listMergedCustomReviewAgents(
  projectId: string
): Promise<CustomReviewAgentRecord[]> {
  const globalAgents = db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.scope, "global"))
    .orderBy(customReviewAgents.position, customReviewAgents.createdAt)
    .all()
    .map((row) => ({ ...row, source: "global" as const }));

  const projectAgents = db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.scope, projectId))
    .orderBy(customReviewAgents.position, customReviewAgents.createdAt)
    .all()
    .map((row) => ({ ...row, source: "project" as const }));

  return [...globalAgents, ...projectAgents];
}

export async function createCustomReviewAgent(input: {
  name: string;
  systemPrompt: string;
  scope: string;
  id: string;
}): Promise<CustomReviewAgentRecord | null> {
  const { name, systemPrompt, scope, id } = input;
  const existing = db
    .select({ id: customReviewAgents.id })
    .from(customReviewAgents)
    .where(
      and(eq(customReviewAgents.scope, scope), eq(customReviewAgents.name, name))
    )
    .get();
  if (existing) {
    return null;
  }

  const maxPositionRow = db
    .select({ maxPosition: max(customReviewAgents.position) })
    .from(customReviewAgents)
    .where(eq(customReviewAgents.scope, scope))
    .get();
  const position = (maxPositionRow?.maxPosition ?? -1) + 1;

  const now = new Date().toISOString();
  db.insert(customReviewAgents)
    .values({
      id,
      name,
      systemPrompt,
      scope,
      position,
      isEnabled: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.id, id))
    .get() ?? null;
}

export async function updateCustomReviewAgent(
  agentId: string,
  updates: { name?: string; systemPrompt?: string; isEnabled?: boolean | number }
): Promise<{ data: CustomReviewAgentRecord | null; error?: string }> {
  const existing = db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.id, agentId))
    .get();
  if (!existing) {
    return { data: null, error: "Custom review agent not found" };
  }

  const patch: Partial<typeof customReviewAgents.$inferInsert> = {};
  if (typeof updates.name === "string") {
    const trimmed = updates.name.trim();
    if (!trimmed) {
      return { data: null, error: "name must not be empty" };
    }

    const duplicate = db
      .select({ id: customReviewAgents.id })
      .from(customReviewAgents)
      .where(
        and(
          eq(customReviewAgents.scope, existing.scope),
          eq(customReviewAgents.name, trimmed),
          sql`${customReviewAgents.id} != ${agentId}`
        )
      )
      .get();
    if (duplicate) {
      return { data: null, error: "name already exists in this scope" };
    }

    patch.name = trimmed;
  }

  if (typeof updates.systemPrompt === "string") {
    patch.systemPrompt = updates.systemPrompt;
  }

  const normalizedEnabled = normalizeIsEnabled(updates.isEnabled);
  if (normalizedEnabled != null) {
    patch.isEnabled = normalizedEnabled;
  }

  if (Object.keys(patch).length === 0) {
    return { data: existing };
  }

  patch.updatedAt = new Date().toISOString();
  db.update(customReviewAgents)
    .set(patch)
    .where(eq(customReviewAgents.id, agentId))
    .run();

  const updated = db
    .select()
    .from(customReviewAgents)
    .where(eq(customReviewAgents.id, agentId))
    .get();
  return { data: updated ?? null };
}

export async function deleteCustomReviewAgent(
  agentId: string
): Promise<boolean> {
  const result = db
    .delete(customReviewAgents)
    .where(eq(customReviewAgents.id, agentId))
    .run();
  return result.changes > 0;
}
