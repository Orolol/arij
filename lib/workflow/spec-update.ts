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

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, epics, namedAgents, projects, releases, userStories } from "@/lib/db/schema";
import { resolveSessionOutput } from "@/lib/claude/resolve-session-output";
import { buildProjectStateSection, buildSpecUpdatePrompt } from "@/lib/claude/prompt-builder";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import { dispatchBackgroundSession } from "@/lib/agent-sessions/dispatch-background-session";
import { tryExportArjiJson } from "@/lib/sync/export";
import { commitGeneratedSpec } from "@/lib/projects/spec-write";

const POLL_INTERVAL_MS = 2000;

/** Sessions of this type queued/running block a new dispatch (see route 409). */
const SPEC_UPDATE_AGENT_TYPE = "spec_generation";

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
  /**
   * Resolution of the run this dispatch launched: never rejects, and resolves
   * only AFTER the terminal hook has run — so a caller that awaits it sees the
   * document the session wrote (or the proof that it wrote nothing). A guard
   * refusal resolves immediately: there was no run to wait for.
   *
   * Exposed for the same reason `dispatchBackgroundSession` exposes its own
   * `settled`: a caller that needs the effect to have landed can await it
   * instead of sleeping for a while and hoping.
   */
  settled: Promise<void>;
}

/** Returns the active (queued or running) spec update session for the project, if any. */
export function getPendingSpecUpdateSession(
  projectId: string
): { id: string; status: string | null } | null {
  const row = db
    .select({ id: agentSessions.id, status: agentSessions.status })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.agentType, SPEC_UPDATE_AGENT_TYPE),
        inArray(agentSessions.status, ["queued", "running"])
      )
    )
    .get();
  return row ?? null;
}

/** True when a spec update session is queued/running for the project. */
export function hasPendingSpecUpdate(projectId: string): boolean {
  return Boolean(getPendingSpecUpdateSession(projectId));
}

/**
 * Strips an accidental full-document code fence from the agent's output
 * (the prompt forbids fences, but a cheap unwrap beats a corrupted doc).
 */
export function sanitizeUpdatedSpec(output: string): string {
  const trimmed = output.trim();
  const fenceMatch = trimmed.match(
    /^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```\s*$/
  );
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  return trimmed;
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
    SPEC_UPDATE_AGENT_TYPE,
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
    SPEC_UPDATE_AGENT_TYPE,
    input.projectId,
    input.namedAgentId
  );
  const prompt = buildSpecUpdatePrompt(
    // Plain row: `id` lets the builder resolve the learned project memory
    // itself, the same way every other dispatch route feeds the builders.
    project,
    input.instruction,
    systemPrompt,
    buildProjectStateSection(
      db
        .select({ id: epics.id, title: epics.title, status: epics.status })
        .from(epics)
        .where(eq(epics.projectId, input.projectId))
        .orderBy(asc(epics.position))
        .all(),
      db
        .select({
          epicId: userStories.epicId,
          title: userStories.title,
          status: userStories.status,
        })
        .from(userStories)
        .innerJoin(epics, eq(userStories.epicId, epics.id))
        .where(eq(epics.projectId, input.projectId))
        .orderBy(asc(userStories.position))
        .all(),
      db
        .select({
          version: releases.version,
          title: releases.title,
          changelog: releases.changelog,
        })
        .from(releases)
        .where(eq(releases.projectId, input.projectId))
        .orderBy(desc(releases.createdAt))
        .all()
    )
  );

  /** Sanitised replacement spec, or "" when the run delivered nothing usable. */
  let output = "";

  // Deliberately no epicId: like the memory distill, a spec update is a
  // project-level background run and must not occupy an epic's concurrency
  // slot or anchor to a ticket.
  const { sessionId, settled } = dispatchBackgroundSession({
    agentType: SPEC_UPDATE_AGENT_TYPE,
    projectId: input.projectId,
    prompt,
    resolvedAgent,
    mode: "plan",
    cwd: project.gitRepoPath ?? undefined,
    pollIntervalMs: POLL_INTERVAL_MS,
    logPrefix: "[spec-update]",
    // Only a delivered answer replaces the spec — silent runs, asked
    // questions, and failures leave it untouched. A run that produced no
    // usable spec is a failure for this workflow even when the CLI exited
    // cleanly: the session row must not claim success over an unchanged
    // document. `evaluate` always runs before `onTerminal`, which is what
    // lets the sanitised output be resolved from the chunks exactly once.
    evaluate: ({ sessionId: sid, result, outcome, completedAt }) => {
      output =
        result?.success && outcome === "answered"
          ? sanitizeUpdatedSpec(resolveSessionOutput(result, sid, ""))
          : "";
      if (output) {
        try {
          commitGeneratedSpec(input.projectId, project.spec, { spec: output }, { updatedAt: completedAt });
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to save the updated specification.",
          };
        }
      }
      return {
        success: Boolean(result?.success && outcome === "answered" && output),
        error: output
          ? null
          : result?.error ??
            (result?.success
              ? outcome === "asked_question"
                ? "The agent asked a question — the saved spec was left unchanged."
                : "The agent finished without returning an updated spec — the saved spec was left unchanged."
              : "The spec update session failed without reporting an error."),
      };
    },
    onTerminal: ({ success }) => {
      if (success) tryExportArjiJson(input.projectId);
    },
  });

  return { sessionId, settled: settled.then(() => undefined) };
}
