/**
 * Agent-run project specification updates.
 *
 * The "Mettre à jour la spec" action on the Spec view dispatches a plan-mode
 * session (same lifecycle as the memory distill: queued session row +
 * per-project scheduler closure). The agent's ENTIRE output is the
 * replacement spec markdown; it is persisted onto `projects.spec` only when
 * the session actually delivers an answer, so a failed run never touches the
 * stored spec.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { namedAgents, projects } from "@/lib/db/schema";
import { buildProjectStateSection, buildSpecUpdatePrompt } from "@/lib/claude/prompt-builder";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import {
  SPEC_GENERATION_AGENT_TYPE,
  dispatchSpecGenerationRun,
  loadSpecBoardState,
} from "./spec-writers";

/**
 * Thrown when the picked named agent no longer exists (a stale dropdown
 * selection). resolveAgentByNamedId would silently fall back to the default
 * chain and run the update with a different agent than the user chose, so
 * dispatch rejects first; the route maps this to a 400 the dialog displays.
 */
export class SpecUpdateAgentNotFoundError extends Error {
  readonly namedAgentId: string;

  constructor(namedAgentId: string) {
    super(
      "The selected agent no longer exists. Pick another agent and try again."
    );
    this.name = "SpecUpdateAgentNotFoundError";
    this.namedAgentId = namedAgentId;
  }
}

export interface DispatchSpecUpdateInput {
  projectId: string;
  /** Optional user instruction steering the update; null/empty = general refresh. */
  instruction: string | null;
  /** Optional named agent override (the Spec view's agent dropdown). */
  namedAgentId: string | null;
}

export interface DispatchSpecUpdateResult {
  sessionId: string;
}

/**
 * Creates a queued spec update session and submits its launch closure to the
 * per-project scheduler. Resolves with the session id immediately; the spec
 * lands in the database when the closure finishes.
 */
export async function dispatchSpecUpdateSession(
  input: DispatchSpecUpdateInput
): Promise<DispatchSpecUpdateResult> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get();
  if (!project) {
    throw new Error("Project not found");
  }
  if (!project.gitRepoPath) {
    throw new Error("Project has no git repository path configured");
  }

  const systemPrompt = await resolveAgentPrompt(
    SPEC_GENERATION_AGENT_TYPE,
    input.projectId
  );
  // Fail loudly on an unknown named agent instead of letting
  // resolveAgentByNamedId fall through to the default chain.
  if (input.namedAgentId) {
    const picked = db
      .select({ id: namedAgents.id })
      .from(namedAgents)
      .where(eq(namedAgents.id, input.namedAgentId))
      .get();
    if (!picked) {
      throw new SpecUpdateAgentNotFoundError(input.namedAgentId);
    }
  }

  const resolvedAgent = resolveAgentByNamedId(
    SPEC_GENERATION_AGENT_TYPE,
    input.projectId,
    input.namedAgentId
  );
  const board = loadSpecBoardState(input.projectId);
  const prompt = buildSpecUpdatePrompt(
    // Plain row: `id` lets the builder resolve the learned project memory
    // itself, the same way every other dispatch route feeds the builders.
    project,
    input.instruction,
    systemPrompt,
    buildProjectStateSection(board.epics, board.userStories, board.releases)
  );

  const { sessionId } = dispatchSpecGenerationRun({
    project,
    prompt,
    resolvedAgent,
    logPrefix: "[spec-update]",
  });

  return { sessionId };
}
