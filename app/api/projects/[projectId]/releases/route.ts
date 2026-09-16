import { runAuthenticatedGit } from "@/lib/git/authenticated";
import { withAgentResolutionErrors } from "@/lib/api/agent-resolution-response";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  releases,
  epics,
  userStories,
  settings,
  agentSessions,
  projects,
} from "@/lib/db/schema";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { createReleaseSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import { GLOBAL_PROMPT_SETTING_KEY } from "@/lib/settings/keys";
import { eq, desc, inArray, and, isNull } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { resolveSessionOutput } from "@/lib/claude/resolve-session-output";
import simpleGit from "simple-git";
import { createDraftRelease } from "@/lib/github/releases";
import { logSyncOperation } from "@/lib/github/sync-log";
import { createReleaseBranchAndCommitChangelog, type ReleaseBranchResult } from "@/lib/git/release";
import { isResumableProvider } from "@/lib/agent-sessions/resume-capability";
import {
  dispatchBackgroundSession,
  type BackgroundSessionSettled,
} from "@/lib/agent-sessions/dispatch-background-session";
import {
  resolveAgentByNamedId,
  type ResolvedAgent,
} from "@/lib/agent-config/agent-resolution";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { applyTransition } from "@/lib/workflow/transition-service";
import { emitReleaseCreated, emitReleaseUpdated } from "@/lib/events/emit";
import { sendProjectWebhook } from "@/lib/webhooks/send";
import { maybeAutoRewriteSpecAfterRelease } from "@/lib/workflow/spec-auto-rewrite";
import { TERMINAL_STATUSES } from "@/lib/agent-sessions/lifecycle-status";
import type { KanbanStatus } from "@/lib/types/kanban";

type Project = typeof projects.$inferSelect;
type Epic = typeof epics.$inferSelect;
type Release = typeof releases.$inferSelect;

/**
 * Releases whose tag, CHANGELOG commit and GitHub draft are being written
 * right now — the in-process lock that makes finalisation run once.
 *
 * Three paths can reach a claimed release's finalisation: the POST itself
 * (no agent), the changelog run's settlement, and the reconciliation in GET
 * below. They can overlap — a session cancelled while running is terminal in
 * the database before its process has exited and settled — and a second
 * concurrent finalisation would recreate the branch and fail the tag. The set
 * serialises them; `finalized_at` makes any later one a no-op. Module state
 * suffices: this server is the only writer, and the lock dies with the
 * process exactly like the runs it guards.
 */
const finalizing = new Set<string>();

function claimFinalization(releaseId: string): boolean {
  if (finalizing.has(releaseId)) return false;
  finalizing.add(releaseId);
  return true;
}

/**
 * An unknown status counts as live: reconciling on a word this code does not
 * know would finalise under a run that may still deliver.
 */
function isLiveSessionStatus(status: string | null): boolean {
  return status !== null && !TERMINAL_STATUSES.has(status);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const rows = db
    .select({ release: releases, changelogSessionStatus: agentSessions.status })
    .from(releases)
    .leftJoin(agentSessions, eq(agentSessions.id, releases.changelogSessionId))
    .where(eq(releases.projectId, projectId))
    .orderBy(desc(releases.createdAt))
    .all();

  // Reconciliation. The changelog run's settlement is what normally
  // finalises a release, and it lives in process memory: a run cancelled
  // while still queued (the scheduler drops its closure), or reaped by a
  // restart, never settles. Such a release is claimed — its epics are
  // released — and would otherwise stay forever without tag, CHANGELOG or
  // GitHub draft, with nothing to retry it. Any unfinalised release whose run
  // is no longer live is finished here, on the changelog the row carries.
  for (const { release, changelogSessionStatus } of rows) {
    if (release.finalizedAt !== null) continue;
    if (isLiveSessionStatus(changelogSessionStatus)) continue;
    reconcileRelease(release);
  }

  // `changelogPending` is derived, never stored: every claimed release is
  // pending until its finalisation has run, whichever path ran it.
  const data = rows.map(({ release }) => ({
    ...release,
    changelogPending: release.finalizedAt === null,
    finalizeErrors: parseFinalizeErrors(release.finalizeErrors),
  }));

  return NextResponse.json({ data });
}

function parseFinalizeErrors(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed.map((entry) => String(entry))
      : null;
  } catch {
    return [raw];
  }
}

/** Finishes an orphaned release in the background; see GET. */
function reconcileRelease(release: Release): void {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, release.projectId))
    .get();
  if (!project) return;
  // Claimed synchronously, before the response: the reply below already says
  // "pending", and a second GET cannot start a second finalisation.
  if (!claimFinalization(release.id)) return;
  void finalizeInBackground({
    releaseId: release.id,
    projectId: release.projectId,
    project,
    version: release.version,
    pushToGitHub: release.pushToGitHub,
  });
}

/** Thrown inside the claim transaction to roll it back into a 409. */
class ReleaseClaimConflict extends Error {}

export const POST = withAgentResolutionErrors(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const validated = await validateBody(createReleaseSchema, request);
  if (isValidationError(validated)) return validated;

  const {
    version,
    epicIds,
    generateChangelog = true,
    pushToGitHub = false,
  } = validated.data;
  const title = validated.data.title?.trim() || null;
  const resumeSessionId = validated.data.resumeSessionId ?? undefined;
  const namedAgentId = validated.data.namedAgentId ?? undefined;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;
  const { project } = found;

  // Read before the synchronous stretch below: the only await this route
  // may take ahead of the claim.
  const releaseNotesPrompt = generateChangelog
    ? await resolveAgentPrompt("release_notes", projectId)
    : "";

  // ---------------------------------------------------------------------
  // From here to the claim transaction there is NO `await`.
  //
  // B-arij-239 moved every status rule ahead of the first side effect; the
  // changelog run then sat between that check and the transaction for
  // minutes, and an epic reopened meanwhile was silently overwritten to
  // "released". Loading, validating and claiming in one synchronous stretch
  // leaves no window: better-sqlite3 cannot interleave another request here.
  // ---------------------------------------------------------------------
  const selectedEpics = db
    .select()
    .from(epics)
    .where(and(inArray(epics.id, epicIds), eq(epics.projectId, projectId)))
    .all();

  const foundEpicIds = new Set(selectedEpics.map((e) => e.id));
  const missingEpicIds = epicIds.filter((id) => !foundEpicIds.has(id));
  if (missingEpicIds.length > 0) {
    return NextResponse.json(
      {
        error: `Ticket(s) not found in this project: ${missingEpicIds.join(", ")}`,
      },
      { status: 400 }
    );
  }

  for (const epic of selectedEpics) {
    const fromStatus = (epic.status ?? "backlog") as KanbanStatus;
    if (fromStatus !== "done") {
      return NextResponse.json(
        {
          error: `Epic "${epic.title}" has status "${fromStatus}" — only "done" epics can be released.`,
        },
        { status: 400 }
      );
    }
  }

  // The request no longer blocks on the agent, so nothing stops a second
  // click (or a reload and a resubmit) from racing the first: one release
  // per version, or the branch `release/v<version>` is reused and the second
  // tag fails silently.
  const existing = db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.projectId, projectId), eq(releases.version, version)))
    .get();
  if (existing) {
    return NextResponse.json(
      { error: `Release v${version} already exists.` },
      { status: 409 }
    );
  }

  // Resolved before the claim: an unusable agent choice is a 400 with nothing
  // written, not a release stuck on a run that never starts.
  const resolvedAgent = generateChangelog
    ? resolveAgentByNamedId("release_notes", projectId, namedAgentId)
    : null;

  const fallbackChangelog = buildFallbackChangelog(version, title, selectedEpics);
  const id = createId();

  try {
    db.transaction((tx) => {
      tx.insert(releases)
        .values({
          id,
          projectId,
          version,
          title,
          changelog: fallbackChangelog,
          epicIds: JSON.stringify(epicIds),
          pushToGitHub,
          createdAt: new Date().toISOString(),
        })
        .run();

      for (const epic of selectedEpics) {
        const fromStatus = (epic.status ?? "backlog") as KanbanStatus;
        const result = applyTransition({
          projectId,
          epicId: epic.id,
          fromStatus,
          toStatus: "released",
          actor: "system",
          source: "release",
          reason: `Released in v${version}`,
        });
        if (!result.valid) {
          throw new ReleaseClaimConflict(
            `Failed to transition epic "${epic.title}": ${result.error}`
          );
        }
        tx.update(epics)
          .set({ releaseId: id })
          .where(eq(epics.id, epic.id))
          .run();
      }
    });
  } catch (error) {
    if (error instanceof ReleaseClaimConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  // The epics moved to "released" just now: the board refreshes on this.
  emitReleaseCreated(projectId, id, version, epicIds);

  const finalizeInput: FinalizeReleaseInput = {
    releaseId: id,
    projectId,
    project,
    version,
    pushToGitHub,
  };

  if (!resolvedAgent) {
    // Claimed in the tick of the insert: a GET landing during the awaits
    // below would otherwise see an unfinalised release with no live run and
    // finalise it a second time.
    claimFinalization(id);
    const githubErrors = await runFinalization(finalizeInput);
    return releaseResponse(id, { githubErrors });
  }

  const claim: FinalizationClaim = { held: false };
  let dispatched: ReturnType<typeof dispatchBackgroundSession>;
  try {
    dispatched = dispatchChangelogRun({
      releaseId: id,
      projectId,
      project,
      version,
      selectedEpics,
      resolvedAgent,
      resumeSessionId,
      releaseNotesPrompt,
      claim,
    });
  } catch (error) {
    // The session row could not even be queued. The release is claimed, so
    // it is finished on the fallback changelog rather than left untagged.
    console.error("[release] failed to dispatch the changelog run", error);
    claimFinalization(id);
    const githubErrors = await runFinalization(finalizeInput);
    return releaseResponse(id, { githubErrors });
  }

  // Not the only way to finalisation: when this never settles (cancelled
  // while queued, process gone), GET /releases reconciles the release.
  void dispatched.settled.then((settled) =>
    completeChangelogRun(settled, fallbackChangelog, finalizeInput, claim)
  );

  return releaseResponse(id, { changelogSessionId: dispatched.sessionId });
});

function releaseResponse(
  releaseId: string,
  extra: { githubErrors?: string[] | null; changelogSessionId?: string }
): NextResponse {
  const release = db.select().from(releases).where(eq(releases.id, releaseId)).get();
  const payload: Record<string, unknown> = { release };
  if (extra.changelogSessionId) payload.changelogSessionId = extra.changelogSessionId;
  if (extra.githubErrors && extra.githubErrors.length > 0) {
    payload.githubErrors = extra.githubErrors;
  }
  return NextResponse.json({ data: payload }, { status: 201 });
}

/* ------------------------------------------------------------------ */
/* The changelog run                                                   */
/* ------------------------------------------------------------------ */

/**
 * Whether the run's own `evaluate` hook took the finalisation lock. Shared
 * between the hook and the settlement handler of one dispatch.
 */
interface FinalizationClaim {
  held: boolean;
}

function dispatchChangelogRun(input: {
  releaseId: string;
  projectId: string;
  project: Project;
  version: string;
  selectedEpics: Epic[];
  resolvedAgent: ResolvedAgent;
  resumeSessionId: string | undefined;
  releaseNotesPrompt: string;
  claim: FinalizationClaim;
}) {
  const { releaseId, projectId, project, resolvedAgent } = input;
  const resumeCliSessionId = resolveResumeCliSessionId(
    projectId,
    resolvedAgent.provider,
    input.resumeSessionId
  );

  return dispatchBackgroundSession({
    agentType: "release_notes",
    projectId,
    prompt: buildChangelogPrompt(
      project.name,
      input.version,
      input.selectedEpics,
      input.releaseNotesPrompt
    ),
    resolvedAgent,
    mode: "plan",
    cwd: project.gitRepoPath || undefined,
    cliSessionId: resumeCliSessionId,
    spawn: resumeCliSessionId ? { resumeSession: true } : undefined,
    session: { worktreePath: project.gitRepoPath || null },
    logPrefix: "[release]",
    // Linked while the row is still queued, so there is no instant at which
    // the release exists, its run exists, and the page cannot connect them.
    onQueued: ({ sessionId }) => {
      db.update(releases)
        .set({ changelogSessionId: sessionId })
        .where(eq(releases.id, releaseId))
        .run();
    },
    // Runs synchronously just before the session row turns terminal: the
    // lock is taken in the same tick, so GET's reconciliation never mistakes
    // a run that is about to finalise for an orphan. It can fail to take it
    // when the reconciliation got there first (the row was cancelled before
    // the process exited); the settlement then leaves the release alone.
    evaluate: (run) => {
      input.claim.held = claimFinalization(releaseId);
      return { success: !!run.result?.success, error: run.result?.error ?? null };
    },
  });
}

/**
 * The previous run's CLI session id, when resuming it is legitimate: same
 * project, same provider, and a provider that can resume at all.
 */
function resolveResumeCliSessionId(
  projectId: string,
  provider: string,
  resumeSessionId: string | undefined
): string | undefined {
  if (!resumeSessionId || !isResumableProvider(provider)) return undefined;
  const previous = db
    .select({
      projectId: agentSessions.projectId,
      provider: agentSessions.provider,
      cliSessionId: agentSessions.cliSessionId,
    })
    .from(agentSessions)
    .where(eq(agentSessions.id, resumeSessionId))
    .get();
  // `cli_session_id` only: the legacy `claude_session_id` column is being
  // dropped (lot 21), and a resume read off it would break on that merge.
  if (
    previous &&
    previous.projectId === projectId &&
    previous.provider === provider &&
    previous.cliSessionId
  ) {
    return previous.cliSessionId;
  }
  return undefined;
}

async function completeChangelogRun(
  settled: BackgroundSessionSettled,
  fallbackChangelog: string,
  input: FinalizeReleaseInput,
  claim: FinalizationClaim
): Promise<void> {
  // `evaluate` did not run when the launch itself failed; take the lock now.
  // Held by someone else = the reconciliation is finalising this release.
  if (!claim.held && !claimFinalization(input.releaseId)) return;

  const output =
    settled.success && settled.result?.result
      ? resolveSessionOutput(settled.result, settled.sessionId, "")
      : "";
  if (output.trim()) {
    // Compare-and-set against the fallback: a changelog the user edited
    // while the agent was running is theirs, and the agent does not get to
    // overwrite it. Nor does it get to rewrite a release already finalised
    // (reconciled on the fallback): the row would then disagree with the
    // CHANGELOG.md committed under the tag.
    db.update(releases)
      .set({ changelog: normalizeAgentChangelog(output) })
      .where(
        and(
          eq(releases.id, input.releaseId),
          eq(releases.changelog, fallbackChangelog),
          isNull(releases.finalizedAt)
        )
      )
      .run();
  }

  await finalizeInBackground(input);
}

/**
 * Finalisation for the paths nobody is waiting on: the errors reach the page
 * through `release:updated` and through the row's `finalize_errors`.
 * The caller holds the lock; it is released here.
 */
async function finalizeInBackground(input: FinalizeReleaseInput): Promise<void> {
  const githubErrors = await runFinalization(input);
  if (githubErrors === null) return;
  emitReleaseUpdated(
    input.projectId,
    input.releaseId,
    githubErrors.length > 0 ? { githubErrors } : {}
  );
}

/**
 * Runs {@link finalizeRelease} under a lock the caller already holds, and
 * releases it. Never rejects: an unexpected throw is recorded on the row as
 * the finalisation's failure, and the release marked finalised, so the
 * reconciliation does not retry a step that has already half-happened.
 *
 * `null` when there was nothing to do (already finalised, or gone).
 */
async function runFinalization(input: FinalizeReleaseInput): Promise<string[] | null> {
  try {
    return await finalizeRelease(input);
  } catch (error) {
    console.error("[release] failed to finalize the release", error);
    const errors = [error instanceof Error ? error.message : String(error)];
    try {
      db.update(releases)
        .set({
          finalizedAt: new Date().toISOString(),
          finalizeErrors: JSON.stringify(errors),
        })
        .where(eq(releases.id, input.releaseId))
        .run();
    } catch {
      // The database itself is failing; the next GET retries.
    }
    return errors;
  } finally {
    finalizing.delete(input.releaseId);
  }
}

/* ------------------------------------------------------------------ */
/* Tag, CHANGELOG commit, GitHub draft                                 */
/* ------------------------------------------------------------------ */

interface FinalizeReleaseInput {
  releaseId: string;
  projectId: string;
  project: Project;
  version: string;
  pushToGitHub: boolean;
}

/**
 * Writes the release's repository and GitHub artefacts from the row's CURRENT
 * changelog and title — whatever the agent, or the user, left there — and
 * stamps them onto the row, with `finalized_at` and the failures. Returns
 * the failures, or `null` when the release was already finalised.
 *
 * Deliberately after the claim: these are the effects that cannot be rolled
 * back, and a rejected request must never have produced them (B-arij-239).
 */
async function finalizeRelease(input: FinalizeReleaseInput): Promise<string[] | null> {
  const { releaseId, projectId, project, version, pushToGitHub } = input;
  const row = db.select().from(releases).where(eq(releases.id, releaseId)).get();
  // Already finalised by another path: every effect below is one-shot.
  if (!row || row.finalizedAt) return null;
  const changelog = row.changelog ?? "";
  const githubErrors: string[] = [];

  let releaseBranchResult: ReleaseBranchResult | null = null;
  let gitTag: string | null = null;
  if (project.gitRepoPath) {
    try {
      releaseBranchResult = await createReleaseBranchAndCommitChangelog(
        project.gitRepoPath,
        version,
        changelog,
        { defaultBranch: project.defaultBranch }
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      githubErrors.push(`Release branch failed: ${errorMsg}`);
    }

    // Tag the release branch commit, not HEAD. No tag at all when the branch
    // itself failed: a tag on whatever happened to be checked out would name
    // a tree that does not carry this release's changelog.
    if (releaseBranchResult) {
      try {
        const git = simpleGit(project.gitRepoPath);
        const tagName = `v${version}`;
        if (releaseBranchResult.commitHash) {
          await git.tag([tagName, releaseBranchResult.commitHash]);
        } else {
          await git.addTag(tagName);
        }
        gitTag = tagName;
      } catch {
        // Tag creation failed, continue without it
      }
    }
  }

  let githubReleaseId: number | null = null;
  let githubReleaseUrl: string | null = null;
  let pushedAt: string | null = null;

  if (pushToGitHub && gitTag && project.githubOwnerRepo && project.gitRepoPath) {
    const [owner, repo] = project.githubOwnerRepo.split("/");

    try {
      await runAuthenticatedGit(project.gitRepoPath, ["push", "origin", gitTag]);
      logSyncOperation({
        projectId,
        operation: "tag_push",
        status: "success",
        detail: { tag: gitTag },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      githubErrors.push(`Tag push failed: ${errorMsg}`);
      logSyncOperation({
        projectId,
        operation: "tag_push",
        status: "failed",
        detail: { tag: gitTag, error: errorMsg },
      });
    }

    try {
      const ghRelease = await createDraftRelease({
        owner,
        repo,
        tag: gitTag,
        title: githubReleaseTitle(version, row.title),
        body: changelog,
      });
      githubReleaseId = ghRelease.id;
      githubReleaseUrl = ghRelease.url;
      // "Pushed to GitHub" — NOT "published". The draft stays a draft until
      // the publish route stamps `publishedAt` (#105).
      pushedAt = new Date().toISOString();
      logSyncOperation({
        projectId,
        operation: "release",
        status: "success",
        detail: { releaseId: ghRelease.id, tag: gitTag, draft: true },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      githubErrors.push(`GitHub release creation failed: ${errorMsg}`);
      logSyncOperation({
        projectId,
        operation: "release",
        status: "failed",
        detail: { tag: gitTag, error: errorMsg },
      });
    }
  }

  db.update(releases)
    .set({
      releaseBranch: releaseBranchResult?.releaseBranch ?? null,
      gitTag,
      githubReleaseId,
      githubReleaseUrl,
      pushedAt,
      finalizedAt: new Date().toISOString(),
      finalizeErrors: githubErrors.length > 0 ? JSON.stringify(githubErrors) : null,
    })
    .where(eq(releases.id, releaseId))
    .run();

  // Outbound signals wait for the final changelog: the webhook announces a
  // tagged release, and the spec rewrite is grounded in its changelog.
  void sendProjectWebhook(projectId, {
    event: "release.created",
    ticketTitle: githubReleaseTitle(version, row.title),
    path: `/projects/${projectId}/releases`,
  });
  // Fire-and-forget spec auto-rewrite ("spec vivante"): a no-op unless the
  // 'spec_auto_rewrite' setting is on. The trigger owns its guards (setting
  // gate, pending spec_generation session) and never rejects.
  void maybeAutoRewriteSpecAfterRelease(projectId, releaseId);

  return githubErrors;
}

/** `v1.2.0 — Title`, or `v1.2.0` without a title. */
function githubReleaseTitle(version: string, title: string | null): string {
  return title ? `v${version} — ${title}` : `v${version}`;
}

/* ------------------------------------------------------------------ */
/* Changelog text                                                      */
/* ------------------------------------------------------------------ */

/**
 * The changelog the release carries until (or instead of) the agent's.
 * `components/releases/derive.ts#buildChangelogPreview` mirrors it byte for
 * byte so the compose card shows exactly this.
 */
function buildFallbackChangelog(
  version: string,
  title: string | null,
  selectedEpics: Epic[]
): string {
  const featureLines = selectedEpics
    .filter((e) => e.type !== "bug")
    .map((e) => `- ${e.title}`);
  const bugLines = selectedEpics
    .filter((e) => e.type === "bug")
    .map((e) => `- ${e.title}`);

  return [
    `# ${version}${title ? ` — ${title}` : ""}`,
    "",
    "## Features",
    featureLines.length > 0 ? featureLines.join("\n") : "- None",
    "",
    "## Bugfixes",
    bugLines.length > 0 ? bugLines.join("\n") : "- None",
    "",
    "## Breaking Changes",
    "- None",
    "",
  ].join("\n");
}

/** Appends any of the three required sections the agent left out. */
function normalizeAgentChangelog(changelog: string): string {
  const normalized = changelog.trim();
  const sections = ["## Features", "## Bugfixes", "## Breaking Changes"];
  const missing = sections.filter(
    (section) => !normalized.toLowerCase().includes(section.toLowerCase())
  );
  if (missing.length === 0) return normalized;
  return [normalized, "", ...missing.flatMap((section) => [section, "- None", ""])]
    .join("\n")
    .trim();
}

function buildChangelogPrompt(
  projectName: string,
  version: string,
  selectedEpics: Epic[],
  releaseNotesPrompt: string
): string {
  const settingsRow = db
    .select()
    .from(settings)
    .where(eq(settings.key, GLOBAL_PROMPT_SETTING_KEY))
    .get();
  const globalPrompt = settingsRow ? JSON.parse(settingsRow.value) : "";
  const combinedInstructions = [globalPrompt, releaseNotesPrompt]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n\n");

  const filteredEpicIds = selectedEpics.map((e) => e.id);
  const storiesByEpic = db
    .select()
    .from(userStories)
    .where(inArray(userStories.epicId, filteredEpicIds.length > 0 ? filteredEpicIds : ["__none__"]))
    .all()
    .reduce<Record<string, Array<{ title: string; acceptanceCriteria: string | null }>>>(
      (acc, story) => {
        const list = acc[story.epicId] || [];
        list.push({
          title: story.title,
          acceptanceCriteria: story.acceptanceCriteria,
        });
        acc[story.epicId] = list;
        return acc;
      },
      {}
    );

  const ticketContext = selectedEpics
    .map((e) => {
      const ticketType = e.type === "bug" ? "Bug" : "Feature";
      const stories = storiesByEpic[e.id] || [];
      const storiesText =
        stories.length === 0
          ? "No user stories"
          : stories
              .map(
                (s) =>
                  `  - ${s.title}${s.acceptanceCriteria ? ` (AC: ${s.acceptanceCriteria})` : ""}`
              )
              .join("\n");
      return [
        `- Ticket: ${e.title}`,
        `  Type: ${ticketType}`,
        `  Description: ${e.description || "No description"}`,
        `  Stories:`,
        storiesText,
      ].join("\n");
    })
    .join("\n");

  return `${combinedInstructions ? `# Instructions\n${combinedInstructions}\n\n` : ""}# Task: Generate Release Changelog

Generate a markdown changelog for version ${version} of project "${projectName}".

## Included Tickets
${ticketContext}

## Instructions
- Write a concise, user-facing changelog in markdown.
- Use exactly these sections in order:
  1) Features
  2) Bugfixes
  3) Breaking Changes
- Use bullet points in each section.
- If no entries exist for a section, include \"- None\".
- If there are breaking changes, include a short migration guide subsection.
- Be specific and avoid generic wording.
- Return ONLY the markdown changelog, no extra text`;
}
