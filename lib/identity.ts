/**
 * Ancient Greek name registry for agent readable identity.
 * Names are assigned deterministically with collision-safe allocation.
 */

export const GREEK_NAMES = [
  "Achilles", "Aether", "Ajax", "Alcmene", "Andromeda",
  "Apollo", "Ares", "Ariadne", "Artemis", "Athena",
  "Atlas", "Calypso", "Cassandra", "Cerberus", "Charon",
  "Circe", "Daedalus", "Demeter", "Dionysus", "Electra",
  "Eos", "Eris", "Eros", "Euclid", "Europa",
  "Gaia", "Hades", "Hecate", "Helen", "Helios",
  "Hephaestus", "Hera", "Heracles", "Hermes", "Hestia",
  "Hypatia", "Icarus", "Io", "Iris", "Jason",
  "Medea", "Medusa", "Midas", "Minos", "Morpheus",
  "Nemesis", "Nike", "Nyx", "Odysseus", "Olympia",
  "Orion", "Orpheus", "Pan", "Pandora", "Paris",
  "Pegasus", "Penelope", "Persephone", "Perseus", "Phoenix",
  "Poseidon", "Prometheus", "Psyche", "Selene", "Siren",
  "Sphinx", "Theseus", "Titan", "Triton", "Zeus",
] as const;

import { db, sqlite } from "@/lib/db";
import { namedAgents } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

/**
 * Assigns a unique readable agent name from the Greek registry.
 * Uses collision-safe allocation: tries base name first, then appends
 * numeric suffixes (e.g., "Athena", "Athena-2", "Athena-3") to
 * guarantee uniqueness at the DB level.
 */
export function assignReadableAgentName(agentId: string): string {
  // Check if already assigned
  const existing = db
    .select({ readableAgentName: namedAgents.readableAgentName })
    .from(namedAgents)
    .where(eq(namedAgents.id, agentId))
    .get();

  if (existing?.readableAgentName) {
    return existing.readableAgentName;
  }

  // Get all currently assigned names
  const allAssigned = db
    .select({ readableAgentName: namedAgents.readableAgentName })
    .from(namedAgents)
    .all()
    .map((r) => r.readableAgentName)
    .filter(Boolean) as string[];

  const usedNames = new Set(allAssigned);

  // Try base names first
  for (const name of GREEK_NAMES) {
    if (!usedNames.has(name)) {
      try {
        sqlite
          .prepare("UPDATE named_agents SET readable_agent_name = ? WHERE id = ? AND readable_agent_name IS NULL")
          .run(name, agentId);
        return name;
      } catch {
        // Collision — another concurrent insert took the name, continue
      }
    }
  }

  // All base names taken — add numeric suffixes
  for (const name of GREEK_NAMES) {
    for (let suffix = 2; suffix <= 999; suffix++) {
      const candidate = `${name}-${suffix}`;
      if (!usedNames.has(candidate)) {
        try {
          sqlite
            .prepare("UPDATE named_agents SET readable_agent_name = ? WHERE id = ? AND readable_agent_name IS NULL")
            .run(candidate, agentId);
          return candidate;
        } catch {
          // Collision — continue
        }
      }
    }
  }

  // Extremely unlikely fallback
  const fallback = `Agent-${agentId.slice(0, 8)}`;
  sqlite
    .prepare("UPDATE named_agents SET readable_agent_name = ? WHERE id = ? AND readable_agent_name IS NULL")
    .run(fallback, agentId);
  return fallback;
}

/**
 * Backfills readable agent names for all named agents that don't have one.
 * Idempotent — only assigns where null.
 */
export function backfillAgentNames(): void {
  const unassigned = db
    .select({ id: namedAgents.id })
    .from(namedAgents)
    .all();

  for (const agent of unassigned) {
    assignReadableAgentName(agent.id);
  }
}
