/**
 * What the two background spec writers share.
 *
 * The manual "update the spec" action (lib/workflow/spec-update.ts) and the
 * release-triggered auto rewrite (lib/workflow/spec-auto-rewrite.ts) used to
 * carry their own copies of every helper below, and the copies had drifted:
 * one sanitiser understood CRLF and `md5`-style info strings, the other did
 * not; one board loader ordered epics and stories by position, the other
 * handed the agent database order; one writer compared the stored spec with
 * the one its prompt reasoned from, the other overwrote whatever a user had
 * saved in the meantime. One module means one behaviour.
 *
 * The write itself goes through commitGeneratedSpec
 * (lib/projects/spec-write.ts), the single writer of `projects.spec` from an
 * agent run — the synchronous generate-spec route included — and both
 * background writers dispatch through dispatchSpecGenerationRun, so the
 * session plumbing (poll interval, cwd, commit-in-evaluate, export on
 * success) cannot drift either.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions, epics, releases, userStories } from "@/lib/db/schema";
import { resolveSessionOutput } from "@/lib/claude/resolve-session-output";
import type { SpecRewriteBoardState } from "@/lib/claude/prompt-builder";
import {
  dispatchBackgroundSession,
  type BackgroundSessionRun,
  type BackgroundSessionVerdict,
} from "@/lib/agent-sessions/dispatch-background-session";
import type { ResolvedAgent } from "@/lib/agent-config/agent-resolution";
import {
  commitGeneratedSpec,
  ProjectSpecChangedError,
  saveConflictingSpecProposal,
} from "@/lib/projects/spec-write";
import { tryExportArjiJson } from "@/lib/sync/export";

/**
 * Both writers dispatch sessions of this type, so one pending-guard covers
 * both: an auto rewrite never starts while a manual update runs, and the
 * other way round.
 */
export const SPEC_GENERATION_AGENT_TYPE = "spec_generation";

/** The active (queued or running) spec_generation session, any origin. */
export function getPendingSpecGenerationSession(
  projectId: string
): { id: string; status: string | null } | null {
  const row = db
    .select({ id: agentSessions.id, status: agentSessions.status })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.projectId, projectId),
        eq(agentSessions.agentType, SPEC_GENERATION_AGENT_TYPE),
        inArray(agentSessions.status, ["queued", "running"])
      )
    )
    .get();
  return row ?? null;
}

/** True when a spec_generation session is queued/running for the project. */
export function hasPendingSpecGeneration(projectId: string): boolean {
  return Boolean(getPendingSpecGenerationSession(projectId));
}

/**
 * Strips an accidental full-document code fence from the agent's output
 * (the prompts forbid fences, but a cheap unwrap beats a corrupted spec).
 *
 * The regex alone is not enough: a spec that opens with one code block and
 * closes with another (```bash … ``` … # Title … ```js … ```) also matches
 * it, from the first opening fence to the last closing one. The captured
 * body must therefore be well-formed on its own — every fence it opens, it
 * closes — or the output is not a wrapped document and is left alone.
 */
export function sanitizeGeneratedSpec(output: string): string {
  const trimmed = output.trim();
  const fenceMatch = trimmed.match(
    /^```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)\r?\n```\s*$/
  );
  if (fenceMatch && hasBalancedFences(fenceMatch[1])) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

/**
 * CommonMark fence pairing, reduced to backticks: any fence line opens a
 * block, only a bare fence closes it (a fence with an info string inside an
 * open block is content).
 */
function hasBalancedFences(body: string): boolean {
  let open = false;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("```")) continue;
    if (!open) open = true;
    else if (/^```\s*$/.test(trimmed)) open = false;
  }
  return !open;
}

/**
 * The board as both prompts see it: epics and stories in the order the user
 * arranged them, releases newest first. A NULL status reads as the column
 * default, so the agent is never told a story sits in the backlog.
 */
export function loadSpecBoardState(projectId: string): SpecRewriteBoardState {
  return {
    epics: db
      .select({ id: epics.id, title: epics.title, status: epics.status })
      .from(epics)
      .where(eq(epics.projectId, projectId))
      .orderBy(asc(epics.position))
      .all()
      .map((e) => ({ id: e.id, title: e.title, status: e.status ?? "backlog" })),
    userStories: db
      .select({
        epicId: userStories.epicId,
        title: userStories.title,
        status: userStories.status,
      })
      .from(userStories)
      .innerJoin(epics, eq(userStories.epicId, epics.id))
      .where(eq(epics.projectId, projectId))
      .orderBy(asc(userStories.position))
      .all()
      .map((s) => ({ epicId: s.epicId, title: s.title, status: s.status ?? "todo" })),
    releases: db
      .select({
        version: releases.version,
        title: releases.title,
        changelog: releases.changelog,
      })
      .from(releases)
      .where(eq(releases.projectId, projectId))
      .orderBy(desc(releases.createdAt))
      .all(),
  };
}

export interface SpecRunVerdict extends BackgroundSessionVerdict {
  /** The committed spec; "" whenever the stored spec was left unchanged. */
  output: string;
}

/**
 * Turns a finished background run into a committed spec — or into a failed
 * verdict naming why the spec was left alone.
 *
 * Meant to be called from `evaluate`, which runs before the session row goes
 * terminal: committing there is what lets a concurrent edit
 * (ProjectSpecChangedError) land on the row as a FAILED session carrying the
 * conflict message, instead of a "completed" row over an unchanged spec.
 */
export function commitSpecFromRun(input: {
  projectId: string;
  /** The spec the prompt was built from, captured at dispatch. */
  expectedSpec: string | null;
  run: BackgroundSessionRun;
}): SpecRunVerdict {
  const { result, outcome, sessionId, completedAt } = input.run;

  if (!result?.success) {
    return {
      success: false,
      error:
        result?.error ?? "The spec generation session failed without reporting an error.",
      output: "",
    };
  }
  if (outcome === "asked_question") {
    return {
      success: false,
      error: "The agent asked a question — the saved spec was left unchanged.",
      output: "",
    };
  }

  const output =
    outcome === "answered"
      ? sanitizeGeneratedSpec(resolveSessionOutput(result, sessionId, ""))
      : "";
  if (!output) {
    return {
      success: false,
      error:
        "The agent finished without returning an updated spec — the saved spec was left unchanged.",
      output: "",
    };
  }

  try {
    commitGeneratedSpec(input.projectId, input.expectedSpec, { spec: output }, {
      updatedAt: completedAt,
    });
  } catch (error) {
    if (error instanceof ProjectSpecChangedError) {
      // The user's newer edit wins, but the rewrite the run paid for must
      // not survive only as session chunks: keep it as a document the
      // failed session names, like the synchronous route's 409 does.
      const proposal = saveConflictingSpecProposal(input.projectId, output);
      return {
        success: false,
        error: specConflictMessage(error, proposal.filename),
        output: "",
      };
    }
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to save the generated specification.",
      output: "",
    };
  }

  return { success: true, error: null, output };
}

/**
 * What a spec conflict tells the user: their edit was kept, and where the
 * agent's rejected proposal went. Shared by the background writers (session
 * error) and the generate-spec route (409 body).
 */
export function specConflictMessage(
  error: ProjectSpecChangedError,
  proposalFilename: string
): string {
  return `${error.message} The agent's proposal is saved in Documents as ${proposalFilename}.`;
}

const SPEC_GENERATION_POLL_INTERVAL_MS = 2000;

/**
 * Dispatches a background spec_generation run whose answer replaces the
 * project spec — the manual update and the release-triggered rewrite differ
 * only in their prompt and agent.
 *
 * Deliberately no epicId: a spec rewrite is a project-level background run
 * and must not occupy an epic's concurrency slot or anchor to a ticket.
 *
 * Only a delivered answer replaces the spec — silent runs, asked questions
 * and failures leave it untouched, and so does a run whose user saved the
 * spec after the prompt captured it (the newer edit wins; the session fails
 * with the conflict message). The commit happens in `evaluate`, which runs
 * before the row goes terminal, so the row never claims success over an
 * unchanged document, and arji.json is re-exported only after a real write.
 */
export function dispatchSpecGenerationRun(input: {
  project: { id: string; spec: string | null; gitRepoPath: string | null };
  /** Built from `project.spec`: the commit refuses to land on anything else. */
  prompt: string;
  resolvedAgent: ResolvedAgent;
  logPrefix: string;
}): {
  sessionId: string;
  /** Resolves once the run's terminal hooks have run (never rejects). */
  settled: Promise<void>;
} {
  const { project } = input;
  const { sessionId, settled } = dispatchBackgroundSession({
    agentType: SPEC_GENERATION_AGENT_TYPE,
    projectId: project.id,
    prompt: input.prompt,
    resolvedAgent: input.resolvedAgent,
    mode: "plan",
    cwd: project.gitRepoPath || process.cwd(),
    pollIntervalMs: SPEC_GENERATION_POLL_INTERVAL_MS,
    logPrefix: input.logPrefix,
    evaluate: (run) =>
      commitSpecFromRun({ projectId: project.id, expectedSpec: project.spec, run }),
    onTerminal: ({ success }) => {
      if (success) tryExportArjiJson(project.id);
    },
  });
  return { sessionId, settled: settled.then(() => undefined) };
}
