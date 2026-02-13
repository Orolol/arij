import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { namedAgents, agentProviderDefaults } from "@/lib/db/schema";
import type { NamedAgent } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { isAgentProvider, type AgentProvider } from "./constants";

export type { NamedAgent };

export interface CreateNamedAgentInput {
  name: string;
  provider: AgentProvider;
  model: string;
}

export interface UpdateNamedAgentInput {
  name?: string;
  provider?: AgentProvider;
  model?: string;
}

/**
 * List all named agents ordered by name.
 */
export function listNamedAgents(): NamedAgent[] {
  return db
    .select()
    .from(namedAgents)
    .orderBy(asc(namedAgents.name))
    .all();
}

/**
 * Get a single named agent by ID.
 */
export function getNamedAgent(id: string): NamedAgent | undefined {
  return db
    .select()
    .from(namedAgents)
    .where(eq(namedAgents.id, id))
    .get();
}

/**
 * Create a new named agent.
 * Validates that the name is unique and the provider is valid.
 */
export function createNamedAgent(input: CreateNamedAgentInput): NamedAgent {
  const { name, provider, model } = input;

  if (!name.trim()) {
    throw new Error("Name is required");
  }

  if (!isAgentProvider(provider)) {
    throw new Error(`Invalid provider: ${provider}`);
  }

  if (!model.trim()) {
    throw new Error("Model is required");
  }

  // Check uniqueness
  const existing = db
    .select({ id: namedAgents.id })
    .from(namedAgents)
    .where(eq(namedAgents.name, name.trim()))
    .get();

  if (existing) {
    throw new Error(`A named agent with name "${name.trim()}" already exists`);
  }

  const id = createId();
  const now = new Date().toISOString();

  db.insert(namedAgents)
    .values({
      id,
      name: name.trim(),
      provider,
      model: model.trim(),
      createdAt: now,
    })
    .run();

  return db
    .select()
    .from(namedAgents)
    .where(eq(namedAgents.id, id))
    .get()!;
}

/**
 * Update an existing named agent. Only updates fields that are provided.
 */
export function updateNamedAgent(
  id: string,
  input: UpdateNamedAgentInput,
): NamedAgent {
  const existing = getNamedAgent(id);
  if (!existing) {
    throw new Error(`Named agent not found: ${id}`);
  }

  const updates: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      throw new Error("Name is required");
    }
    // Check uniqueness (allow same ID)
    const duplicate = db
      .select({ id: namedAgents.id })
      .from(namedAgents)
      .where(eq(namedAgents.name, trimmedName))
      .get();
    if (duplicate && duplicate.id !== id) {
      throw new Error(`A named agent with name "${trimmedName}" already exists`);
    }
    updates.name = trimmedName;
  }

  if (input.provider !== undefined) {
    if (!isAgentProvider(input.provider)) {
      throw new Error(`Invalid provider: ${input.provider}`);
    }
    updates.provider = input.provider;
  }

  if (input.model !== undefined) {
    const trimmedModel = input.model.trim();
    if (!trimmedModel) {
      throw new Error("Model is required");
    }
    updates.model = trimmedModel;
  }

  if (Object.keys(updates).length > 0) {
    db.update(namedAgents)
      .set(updates)
      .where(eq(namedAgents.id, id))
      .run();
  }

  return getNamedAgent(id)!;
}

/**
 * Delete a named agent and nullify any referencing agentProviderDefaults rows.
 */
export function deleteNamedAgent(id: string): boolean {
  const existing = getNamedAgent(id);
  if (!existing) {
    return false;
  }

  // Nullify references in agentProviderDefaults
  db.update(agentProviderDefaults)
    .set({ namedAgentId: null })
    .where(eq(agentProviderDefaults.namedAgentId, id))
    .run();

  // Delete the named agent
  db.delete(namedAgents)
    .where(eq(namedAgents.id, id))
    .run();

  return true;
}
