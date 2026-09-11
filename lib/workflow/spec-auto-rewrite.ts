/**
 * Automatic spec rewrite ("spec vivante") — release-triggered workflow.
 *
 * The project specification (`projects.spec`) is injected into every agent
 * prompt for the project, so a stale spec quietly degrades every session.
 * When the 'spec_auto_rewrite' setting is on, publishing a release
 * (POST /api/projects/:id/releases) fires this trigger: a plan-mode
 * 'spec_generation' session rewrites the spec to match the project's
 * current reality, grounded in the board state and the release changelog.
 * The stored spec is replaced only when the session actually delivers an
 * answer — a failed run never touches it.
 *
 * Same lifecycle as the memory distill (lib/workflow/memory-distill.ts):
 * setting gate → pure guard matrix → queued session row → per-project
 * scheduler closure.
 *
 * Coexistence with the manual "ask an agent to update the spec" flow: BOTH
 * writers dispatch sessions of agent type 'spec_generation' and share one
 * pending-guard, one sanitiser, one board loader and one commit
 * (lib/workflow/spec-writers.ts), so an auto rewrite never starts while a
 * manual update runs and neither overwrites a spec the user saved after the
 * prompt captured it.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects, releases, settings } from "@/lib/db/schema";
import { buildSpecAutoRewritePrompt } from "@/lib/claude/prompt-builder";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import {
  SPEC_AUTO_REWRITE_SETTING_KEY,
  parseSpecAutoRewriteSetting,
} from "./spec-rewrite-constants";
import {
  SPEC_GENERATION_AGENT_TYPE,
  dispatchSpecGenerationRun,
  hasPendingSpecGeneration,
  loadSpecBoardState,
} from "./spec-writers";

/** Reads the 'spec_auto_rewrite' setting (DEFAULT OFF when absent). */
export function isSpecAutoRewriteEnabled(): boolean {
  try {
    const row = db
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, SPEC_AUTO_REWRITE_SETTING_KEY))
      .get();
    return row ? parseSpecAutoRewriteSetting(row.value) : false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Auto-trigger guards
// ---------------------------------------------------------------------------

export interface SpecAutoRewriteDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Pure guard matrix for the release trigger — exported for exhaustive
 * testing. Denials are silent by design: a release must never fail because
 * the spec refresh declined to run.
 */
export function evaluateSpecAutoRewriteGuards(input: {
  enabled: boolean;
  hasRelease: boolean;
  hasPendingSpecSession: boolean;
}): SpecAutoRewriteDecision {
  if (!input.enabled) {
    return { allowed: false, reason: "spec auto-rewrite setting is off" };
  }
  if (!input.hasRelease) {
    return { allowed: false, reason: "release row not found" };
  }
  if (input.hasPendingSpecSession) {
    return {
      allowed: false,
      reason: "a spec update is already queued/running for this project",
    };
  }
  return { allowed: true, reason: "ok" };
}

/**
 * Auto-trigger entry point, invoked (fire-and-forget) from the release
 * creation route after the release transaction commits. Best-effort by
 * design: it must never throw into the request, and every denial is
 * silent except for unexpected errors (logged).
 */
export async function maybeAutoRewriteSpecAfterRelease(
  projectId: string,
  releaseId: string
): Promise<SpecAutoRewriteDecision> {
  try {
    // Cheapest check first — the feature is off by default.
    const enabled = isSpecAutoRewriteEnabled();
    if (!enabled) {
      return { allowed: false, reason: "spec auto-rewrite setting is off" };
    }

    const release = db
      .select({ id: releases.id })
      .from(releases)
      .where(and(eq(releases.id, releaseId), eq(releases.projectId, projectId)))
      .get();

    const decision = evaluateSpecAutoRewriteGuards({
      enabled,
      hasRelease: !!release,
      hasPendingSpecSession: hasPendingSpecGeneration(projectId),
    });

    if (!decision.allowed) {
      return decision;
    }

    await dispatchSpecAutoRewriteSession({ projectId, releaseId });
    return decision;
  } catch (err) {
    console.warn(
      "[spec-auto-rewrite] Auto-rewrite trigger failed:",
      (err as Error).message
    );
    return { allowed: false, reason: "spec auto-rewrite trigger failed" };
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface DispatchSpecAutoRewriteInput {
  projectId: string;
  /** The release whose changelog grounds the rewrite. */
  releaseId: string;
}

export interface DispatchSpecAutoRewriteResult {
  sessionId: string;
}

/**
 * Creates a queued 'spec_generation' session and submits its launch closure
 * to the per-project scheduler. Resolves with the session id immediately;
 * the spec lands in the database when the closure finishes.
 */
export async function dispatchSpecAutoRewriteSession(
  input: DispatchSpecAutoRewriteInput
): Promise<DispatchSpecAutoRewriteResult> {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get();
  if (!project) {
    throw new Error("Project not found");
  }

  const release = db
    .select({
      version: releases.version,
      title: releases.title,
      changelog: releases.changelog,
    })
    .from(releases)
    .where(
      and(
        eq(releases.id, input.releaseId),
        eq(releases.projectId, input.projectId)
      )
    )
    .get();
  if (!release) {
    throw new Error("Release not found");
  }

  const systemPrompt = await resolveAgentPrompt(
    SPEC_GENERATION_AGENT_TYPE,
    input.projectId
  );
  // Auto trigger: no named-agent override — the default spec_generation
  // agent (or its project override) does the work.
  const resolvedAgent = resolveAgentByNamedId(
    SPEC_GENERATION_AGENT_TYPE,
    input.projectId,
    null
  );

  const prompt = buildSpecAutoRewritePrompt(
    project,
    project.spec,
    loadSpecBoardState(input.projectId),
    release,
    systemPrompt
  );

  // Same run as the manual update. The commit-time spec check matters most
  // here: a release may leave the session queued for a while, and a Spec
  // view opened before the release does not know it is running.
  const { sessionId } = dispatchSpecGenerationRun({
    project,
    prompt,
    resolvedAgent,
    logPrefix: "[spec-auto-rewrite]",
  });

  return { sessionId };
}
