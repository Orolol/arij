import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { dispatchBackgroundSession } from "@/lib/agent-sessions/dispatch-background-session";
import { CODE_AGENT_ALLOWED_TOOLS, dispatchBuildSession } from "@/lib/agent-sessions/dispatch-ticket-session";
import { createSessionLogsPath } from "@/lib/agent-sessions/session-paths";
import {
  buildBuildPrompt,
  buildTeamBuildPrompt,
  type TeamEpic,
} from "@/lib/claude/prompt-builder";
import {
  resolveSessionOutput
} from "@/lib/claude/resolve-session-output";
import { isVisualProofEnabled } from "@/lib/claude/visual-proof";
import { db } from "@/lib/db";
import {
  epics,
  projects,
  ticketComments,
  userStories,
} from "@/lib/db/schema";
import { startWaveBatch } from "@/lib/dependencies/start-wave-batch";
import { emitSessionCompleted, emitSessionFailed, emitSessionStarted } from "@/lib/events/emit";
import { createWorktree, isGitRepo } from "@/lib/git/manager";
import { createId } from "@/lib/utils/nanoid";
import { batchBuildSchema } from "@/lib/validation/build-schemas";
import { handleAskedQuestionOutcome } from "@/lib/workflow/agent-question";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import { supportsTeamDelegation } from "@/lib/providers/capabilities";
import { mintAssignedCliSessionId } from "@/lib/agent-sessions/dispatch-background-session";
import {
  createAgentAlreadyRunningPayload,
  getRunningSessionForTarget,
} from "@/lib/agents/concurrency";
import { dagBatchRegistry } from "@/lib/agents/dag-batch-registry";
import { buildExecutionPlan } from "@/lib/dependencies/scheduler";
import {
  filterBuildableTickets,
  getTransitiveDependencies,
  loadProjectGraph,
} from "@/lib/dependencies/validation";
import {
  countPlanStatuses,
  type WaveTicketResult
} from "@/lib/dependencies/wave-runner";
import { NIGHT_RUN_ID_PREFIX } from "@/lib/night/constants";
import { nightRunRegistry } from "@/lib/night/registry";
import { startNightRun } from "@/lib/night/run";
import { listPipelineRunsByProject } from "@/lib/pipeline";
import { isPipelineRunActive } from "@/lib/pipeline/constants";
import { tryExportArjiJson } from "@/lib/sync/export";
import {
  createPromptSectionCapture,
  finalizeCapturedPrompt,
} from "@/lib/tokens/dispatch-prompt";
import {
  finalizeBuildTerminalOutcome,
  holdFailedBuild,
  pullTicketBackIfPromoted,
  resolveBuildSessionResult,
  transitionBuildStarted,
  WorkflowTransitionError,
} from "@/lib/workflow/automatic-transitions";

/**
 * Batch build options (everything except `epicIds`, which keeps its
 * historical bespoke check and error message). `failurePolicy` only matters
 * in "dag" mode:
 *   - "halt" (default): a blocked epic skips its dependents, but independent
 *     branches keep building.
 *   - "stop": abandon all remaining waves after the first blocked wave.
 *
 * `pipeline: true` is only legal with mode "dag" and turns the batch into a
 * NIGHT RUN: every epic runs the full autonomous pipeline, waves settle at
 * pipeline terminal, and the breaker/cost-cap overrides apply (see
 * lib/night). The pipeline_enabled setting is deliberately ignored here —
 * the explicit request flag is the only trigger.
 */


const preparingProjects = new Set<string>();

export async function dispatchBatchBuild(projectId: string, body: Record<string, unknown>) {
  if (preparingProjects.has(projectId)) return NextResponse.json({ error: "A batch is being prepared", code: "BATCH_ACTIVE" }, { status: 409 });
  preparingProjects.add(projectId);
  try { return await prepareBatchBuild(projectId, body); }
  finally { preparingProjects.delete(projectId); }
}

async function prepareBatchBuild(projectId: string, body: Record<string, unknown>) {
  const epicIdsInput = body?.epicIds;

  if (!Array.isArray(epicIdsInput) || epicIdsInput.length === 0) {
    return NextResponse.json(
      { error: "epicIds array is required" },
      { status: 400 }
    );
  }

  const parsedOptions = batchBuildSchema.safeParse(body ?? {});
  if (!parsedOptions.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: parsedOptions.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }
  const {
    epicIds,
    mode,
    team,
    namedAgentId,
    failurePolicy,
    pipeline,
    circuitBreaker,
    costCapUsd,
  } = parsedOptions.data;

  // Pipelines compose with the wave engine only: each epic's ticket settles
  // at PIPELINE terminal, so dependency ordering stays meaningful. The flat
  // batch modes have no blocking semantics to hang a pipeline on.
  if (pipeline && mode !== "dag") {
    return NextResponse.json(
      { error: "Pipeline batch builds run as dependency waves — use mode 'dag'" },
      { status: 400 }
    );
  }

  if (team && mode === "dag") {
    return NextResponse.json(
      { error: "Team mode cannot be combined with wave (dag) mode" },
      { status: 400 }
    );
  }

  // DAG mode plans over the full dependency closure: the client auto-includes
  // prerequisites too, but the server re-expands so the waves are complete
  // even for direct API callers. The closure already stops at done/released
  // prerequisites (they are satisfied, not work).
  const targetEpicIds =
    mode === "dag"
      ? Array.from(getTransitiveDependencies(projectId, epicIds))
      : epicIds;

  // Conflict check up-front so batch launches fail fast with a deterministic payload.
  for (const epicId of targetEpicIds) {
    const conflict = getRunningSessionForTarget({
      scope: "epic",
      projectId,
      epicId,
    });
    if (conflict) {
      return NextResponse.json(
        createAgentAlreadyRunningPayload(
          { scope: "epic", projectId, epicId },
          conflict,
          "Another agent is already running for this epic."
        ),
        { status: 409 }
      );
    }
  }

        if (nightRunRegistry.getActiveByProject(projectId)) {
          return NextResponse.json(
            {
              error: "A night run is already active for this project",
              code: "NIGHT_RUN_ACTIVE",
            },
            { status: 409 }
          );
        }
        if (dagBatchRegistry.listByProject(projectId).length > 0) {
          return NextResponse.json(
            {
              error:
                "A wave batch build is already running for this project",
              code: "BATCH_ACTIVE",
            },
            { status: 409 }
          );
        }
        const buildableSet = new Set(targetEpicIds);
        const activePipeline = listPipelineRunsByProject(projectId).find(
          (run) => isPipelineRunActive(run.state) && buildableSet.has(run.epicId)
        );
        if (activePipeline) {
          return NextResponse.json(
            {
              error:
                "An autonomous pipeline is already running on an epic in the selection",
              code: "PIPELINE_ACTIVE_ON_EPIC",
            },
            { status: 409 }
          );
        }

  // Only providers with an implemented Task runtime may coordinate a team.
  const resolvedTeamCheck = resolveAgentByNamedId("team_build", projectId, namedAgentId);
  if (team && !supportsTeamDelegation(resolvedTeamCheck.provider)) {
    return NextResponse.json(
      { error: "Team mode is available with Claude Code and Pi (Arij). This provider does not support sub-agent delegation." },
      { status: 400 }
    );
  }

  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (!project.gitRepoPath) {
    return NextResponse.json(
      { error: "Project has no git repository configured" },
      { status: 400 }
    );
  }

  const gitRepoPath = project.gitRepoPath;
  // Captured alongside gitRepoPath: the closures below outlive the narrowing
  // TypeScript does on `project` here.
  const projectDefaultBranch = project.defaultBranch;

  const isRepo = await isGitRepo(gitRepoPath);
  if (!isRepo) {
    return NextResponse.json(
      { error: `Path is not a git repository: ${gitRepoPath}` },
      { status: 400 }
    );
  }

  // Load project context
  const buildSystemPrompt = await resolveAgentPrompt("build", projectId);
  const teamBuildSystemPrompt = await resolveAgentPrompt(
    "team_build",
    projectId
  );

  const sessionsCreated: string[] = [];
  const projectRef = project;

  // -----------------------------------------------------------------------
  // TEAM MODE — single coordinator session managing multiple epics via Task tool
  // -----------------------------------------------------------------------
  if (team) {
    try {
      const resolvedTeamAgent = resolveAgentByNamedId(
        "team_build",
        projectId,
        namedAgentId
      );
      if (!supportsTeamDelegation(resolvedTeamAgent.provider)) {
        return NextResponse.json(
          { error: "Team mode is available with Claude Code and Pi (Arij)." },
          { status: 400 }
        );
      }

      const sessionId = createId();
      // Validate every ticket before the first move. A guard failure on one
      // epic must not leave earlier epics in_progress without the shared
      // team session.
      for (const epicId of epicIds) {
        transitionBuildStarted({
          projectId,
          epicId,
          scope: "epic",
          sessionId,
          reason: "Team build agent started",
          validateOnly: true,
        });
      }

      // Pre-create all worktrees
      const teamEpics: TeamEpic[] = [];
      const epicRecords: Array<{ id: string; branchName: string }> = [];

      for (const epicId of epicIds) {
        const epic = db.select().from(epics).where(eq(epics.id, epicId)).get();
        if (!epic) continue;

        const us = db
          .select()
          .from(userStories)
          .where(eq(userStories.epicId, epicId))
          .orderBy(userStories.position)
          .all();

        const { worktreePath, branchName } = await createWorktree(
          gitRepoPath,
          epic.id,
          epic.title,
          { defaultBranch: projectDefaultBranch }
        );

        teamEpics.push({
          title: epic.title,
          description: epic.description,
          worktreePath,
          userStories: us,
          // A bug batched into a team build carries its screenshots like any
          // other dispatch; solo mode gets them by passing the row whole.
          projectId: epic.projectId,
          images: epic.images,
          // Without this, the bug red→green prompt section is dead in
          // every production team build — the optional field silently
          // defaults to undefined.
          type: epic.type,
        });

        epicRecords.push({ id: epicId, branchName });

        const now = new Date().toISOString();
        transitionBuildStarted({
          projectId,
          epicId,
          scope: "epic",
          sessionId,
          reason: "Team build agent started",
        });
        db.update(epics)
          .set({ branchName, updatedAt: now })
          .where(eq(epics.id, epicId))
          .run();
      }

      // Build team prompt
      const prompt = buildTeamBuildPrompt(
        projectRef,
        [],
        teamEpics,
        teamBuildSystemPrompt
      );
      // No document mentions to resolve: the batch prompt carries no
      // user-written text — epic and story fields are generated content, and
      // an agent's `@some/file.ts` points at the project's codebase, not Docs.
      const enrichedTeamPrompt = prompt;
      // Create single team session
      const now = new Date().toISOString();

      const teamCliSessionId = mintAssignedCliSessionId(
        resolvedTeamAgent.provider,
      );

      // Update project status
      db.update(projects)
        .set({ status: "building", updatedAt: now })
        .where(eq(projects.id, projectId))
        .run();

      // Scheduled team launch: one slot for the whole coordinating session.
      // Spawns a single CC session from main repo root with Task in
      // allowedTools, waits for completion, updates all epic statuses.
      const allEpicIds = epicRecords.map((e) => e.id);
      dispatchBackgroundSession({ sessionId, cliSessionId: teamCliSessionId, projectId,
        agentType: "team_build", mode: "code", prompt: enrichedTeamPrompt, resolvedAgent: resolvedTeamAgent,
        cwd: gitRepoPath, session: { orchestrationMode: "team" },
        spawn: { allowedTools: [...CODE_AGENT_ALLOWED_TOOLS, "Task"] }, logPrefix: "[build/team]",
        onQueued: () => { for (const eid of allEpicIds) emitSessionStarted(projectId, eid, sessionId, "team_build"); },
        onTerminal: ({ result, outcome, completedAt, success, error }) => {
        // Update all associated epics unless the agent ended by asking a question.
        if (result?.success && outcome !== "asked_question") {
          for (const eid of allEpicIds) {
            finalizeBuildTerminalOutcome({
              projectId,
              epicId: eid,
              scope: "epic",
              sessionId,
              success: true,
              outcome,
              reason: "Team build completed successfully",
            });
          }
        } else if (result?.success) {
          // asked_question: the work is not delivered, so a coordinated epic
          // the agent promoted to Review mid-run comes back first; then hold
          // every coordinated epic, notify once, and log on each feed. Each
          // epic is logged with the status its own pullback actually left it
          // in — a coordinated set can straddle several columns, so one
          // shared guess would put a false hold entry on the others.
          const heldStatusByEpicId: Record<string, string> = {};
          for (const eid of allEpicIds) {
            heldStatusByEpicId[eid] = pullTicketBackIfPromoted({
              projectId,
              epicId: eid,
              scope: "epic",
              sessionId,
              reason:
                "The team build ended with an open question; returning ticket to in_progress",
            });
          }
          handleAskedQuestionOutcome({
            projectId,
            epicIds: allEpicIds,
            sessionId,
            ticketStatusByEpicId: heldStatusByEpicId,
          });
        } else {
          for (const eid of allEpicIds) {
            holdFailedBuild({
              projectId,
              epicId: eid,
              sessionId,
              error: result?.error,
            });
          }
        }

        // Post output as comment on each epic
        const teamOutput = resolveSessionOutput(result, sessionId);

        for (const eid of allEpicIds) {
          db.insert(ticketComments)
            .values({
              id: createId(),
              epicId: eid,
              author: "agent",
              content: teamOutput,
              agentSessionId: sessionId,
              createdAt: completedAt,
            })
            .run();
          if (success) emitSessionCompleted(projectId, eid, sessionId);
          else emitSessionFailed(projectId, eid, sessionId, error ?? "Team build failed");
        }
        },
        onLaunchFailure: (error) => { for (const eid of allEpicIds) emitSessionFailed(projectId, eid, sessionId, error instanceof Error ? error.message : "Team build launch failed"); },
      });

      sessionsCreated.push(sessionId);
      tryExportArjiJson(projectId);

      return NextResponse.json({
        data: {
          sessions: sessionsCreated,
          count: sessionsCreated.length,
          orchestrationMode: "team",
        },
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Team build launch failed" },
        { status: e instanceof WorkflowTransitionError ? 409 : 500 }
      );
    }
  }

  // Batch/night run tag stamped on every session this request creates
  // (agent_sessions.batch_run_id). Set by the dag branch (plain batches get
  // their batchId, night runs their night_ runId); parallel
  // dispatches stay untagged.
  let currentBatchRunId: string | null = null;

  // -----------------------------------------------------------------------
  // SOLO MODE — one session per epic (existing behavior). DAG mode reuses
  // this launcher wave by wave; the returned `settled` promise resolves when
  // the session reaches a terminal state (it never rejects).
  // -----------------------------------------------------------------------
  async function launchEpic(
    epicId: string
  ): Promise<
    { sessionId: string; settled: Promise<WaveTicketResult> } | undefined
  > {
    const epic = db.select().from(epics).where(eq(epics.id, epicId)).get();
    if (!epic) return;

    const us = db
      .select()
      .from(userStories)
      .where(eq(userStories.epicId, epicId))
      .orderBy(userStories.position)
      .all();

    const preflightConflict = getRunningSessionForTarget({ scope: "epic", projectId, epicId });
    if (preflightConflict) throw createAgentAlreadyRunningPayload({ scope: "epic", projectId, epicId }, preflightConflict);
    transitionBuildStarted({ projectId, epicId, scope: "epic", sessionId: createId(), validateOnly: true });
    // Create worktree + branch
    const { worktreePath, branchName } = await createWorktree(
      gitRepoPath,
      epic.id,
      epic.title,
      { defaultBranch: projectDefaultBranch }
    );

    // Compose prompt
    const promptSections = createPromptSectionCapture();
    const prompt = buildBuildPrompt(
      projectRef,
      [],
      epic,
      us,
      buildSystemPrompt,
      undefined,
      {
        visualProofEnabled: isVisualProofEnabled(),
        sectionCollector: promptSections.collect,
      },
    );
    // Same as team mode: nothing user-written to resolve mentions from.
    const enrichedPrompt = prompt;
    const estimatedPrompt = finalizeCapturedPrompt(
      enrichedPrompt,
      promptSections,
    );
    const resolvedBuildAgent = resolveAgentByNamedId("build", projectId, namedAgentId);

    // Create session in DB
    const sessionId = createId();
    const now = new Date().toISOString();
    const logsPath = createSessionLogsPath(sessionId);

    // Check concurrency guard first
    const conflict = getRunningSessionForTarget({
      scope: "epic",
      projectId,
      epicId,
    });
    if (conflict) {
      throw createAgentAlreadyRunningPayload(
        { scope: "epic", projectId, epicId },
        conflict,
        "Another agent is already running for this epic."
      );
    }

    const soloCliSessionId = mintAssignedCliSessionId(
      resolvedBuildAgent.provider,
    );

    transitionBuildStarted({
      projectId,
      epicId,
      scope: "epic",
      sessionId,
    });
    db.update(epics)
      .set({ branchName, updatedAt: now })
      .where(eq(epics.id, epicId))
      .run();

    const row = {
      id: sessionId,
      projectId,
      epicId,
      mode: "code" as const,
      orchestrationMode: "solo",
      provider: resolvedBuildAgent.provider,
      prompt: enrichedPrompt,
      estimatedPromptTokens: estimatedPrompt.tokens.total,
      estimatedPromptBreakdown: JSON.stringify(
        estimatedPrompt.tokens.breakdown,
      ),
      logsPath,
      branchName,
      worktreePath,
      cliSessionId: soloCliSessionId,
      namedAgentId: resolvedBuildAgent.namedAgentId ?? null,
      compositeAgentId: resolvedBuildAgent.compositeAgentId ?? null,
      agentType: "build",
      namedAgentName: resolvedBuildAgent.name || null,
      model: resolvedBuildAgent.model || null,
      batchRunId: currentBatchRunId,
      createdAt: now,
    };

    // Update project status to building
    db.update(projects)
      .set({ status: "building", updatedAt: now })
      .where(eq(projects.id, projectId))
      .run();

    // Launch closure body: spawns the agent, waits for completion, and
    // updates the DB. Submitted to the per-project scheduler below — a batch
    // of N epics enqueues N sessions but only maxConcurrent CLIs run at once.
    const dispatched = dispatchBuildSession({ row, resolvedAgent: resolvedBuildAgent,
      onTerminal: ({ result, outcome, completedAt }) => {
      const terminal = finalizeBuildTerminalOutcome({
        projectId,
        epicId,
        scope: "epic",
        sessionId,
        success: !!result?.success,
        outcome,
        error: result?.error,
      });

      // Post output as epic comment
      const output = resolveSessionOutput(result, sessionId);

      db.insert(ticketComments)
        .values({
          id: createId(),
          epicId,
          author: "agent",
          content: output,
          agentSessionId: sessionId,
          createdAt: completedAt,
        })
        .run();

      return resolveBuildSessionResult(terminal, {
        success: !!result?.success,
        outcome,
        error: result?.error ?? null,
      });
    }});


    sessionsCreated.push(sessionId);
    return { sessionId, settled: dispatched.settled.then((result) => ({ epicId, ...result })) };
  }

  // -----------------------------------------------------------------------
  // DAG MODE — dependency-ordered waves over the full closure.
  // Wave N launches through the scheduler (budget still throttles CLIs),
  // the engine waits for every session to settle, then wave N+1 starts.
  // Blocked epics (failed session or asked_question) skip their transitive
  // dependents: no session, an activity-log entry.
  // -----------------------------------------------------------------------
  if (mode === "dag" || mode === "sequential") {
    try {
      // A done/released epic explicitly named in the selection is dropped
      // here: it is already delivered, so it gets no wave, no session, and
      // (being absent from the plan) never blocks a dependent — a dependent
      // whose only prerequisites are done therefore lands in wave 1.
      const buildableEpicIds = filterBuildableTickets(projectId, targetEpicIds);
      if (buildableEpicIds.length === 0) {
        return NextResponse.json(
          {
            error:
              "No buildable epics in the selection — every ticket is already done or released",
          },
          { status: 400 }
        );
      }

      const plan = buildExecutionPlan(projectId, buildableEpicIds);
      if (mode === "sequential") plan.layers = plan.layers.flatMap((layer) => layer.map((id) => [id]));
      const graph = loadProjectGraph(projectId);
      const totalWaves = plan.layers.length;

      // -------------------------------------------------------------------
      // NIGHT SEMANTICS — dag + pipeline. Guards run synchronously between
      // the plan build and startNightRun (which registers the run before
      // returning), so the double-POST race window is a single sync block.
      // Conflicting work is refused in every batch mode.
      // -------------------------------------------------------------------
      if (pipeline) {
        const nightRunId = `${NIGHT_RUN_ID_PREFIX}${createId()}`;
        currentBatchRunId = nightRunId;

        const { firstWaveLaunched, engineDone } = startNightRun({
          projectId,
          runId: nightRunId,
          plan,
          graph,
          failurePolicy,
          namedAgentId,
          breakerThreshold: circuitBreaker ?? null,
          costCapUsd: costCapUsd ?? null,
          launchBuild: async (epicId) => (await launchEpic(epicId)) ?? null,
        });

        const firstWaveSessions = await Promise.race([
          firstWaveLaunched,
          engineDone.then(() => [] as string[]),
        ]);

        tryExportArjiJson(projectId);
        return NextResponse.json({
          data: {
            sessions: firstWaveSessions,
            count: firstWaveSessions.length,
            orchestrationMode: "dag",
            batchId: nightRunId,
            waves: totalWaves,
            totalEpics: buildableEpicIds.length,
            failurePolicy,
            pipeline: true,
          },
        });
      }

      const batchId = createId();
      // Retroactive benefit: plain DAG batches tag their sessions too.
      currentBatchRunId = batchId;

      dagBatchRegistry.start({
        batchId,
        projectId,
        failurePolicy,
        totalWaves,
        totalEpics: buildableEpicIds.length,
      });

      const { firstWaveLaunched, engineDone: engineRun } = startWaveBatch({
        projectId,
        plan,
        graph,
        failurePolicy,
        launch: async (epicId) => (await launchEpic(epicId)) ?? null,
        callbacks: {
          onWaveStart: (wave) => {
            dagBatchRegistry.setWave(batchId, wave);
            dagBatchRegistry.setCounts(batchId, countPlanStatuses(plan));
          },
          onWaveSettled: () => {
            dagBatchRegistry.setCounts(batchId, countPlanStatuses(plan));
          },
          onFinish: () => {
            dagBatchRegistry.setCounts(batchId, countPlanStatuses(plan));
            dagBatchRegistry.finish(batchId);
          },
        },
      });

      // The engine outlives this request — waves 2+ launch after the
      // response. Launch failures become wave results, so a rejection here
      // is an engine bug, not a build failure.
      const engineSafe = engineRun.catch((error) => {
        console.error("[build/dag] Wave engine crashed", error);
        dagBatchRegistry.finish(batchId);
        return null;
      });

      const firstWaveSessions = await Promise.race([
        firstWaveLaunched,
        engineSafe.then(() => [] as string[]),
      ]);

      tryExportArjiJson(projectId);
      return NextResponse.json({
        data: {
          sessions: firstWaveSessions,
          count: firstWaveSessions.length,
          orchestrationMode: "dag",
          batchId,
          waves: totalWaves,
          totalEpics: buildableEpicIds.length,
          failurePolicy,
        },
      });
    } catch (e) {
      // Synchronous planning failures only — per-epic launch errors inside
      // waves are handled by the engine.
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Wave build launch failed" },
        { status: 500 }
      );
    }
  }

  try {
    const results = await Promise.allSettled(epicIds.map(launchEpic));
    const rejected = results.flatMap((result, index) => result.status === "rejected" ? [{ epicId: epicIds[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason?.error ?? result.reason) }] : []);

    tryExportArjiJson(projectId);
    return NextResponse.json({
      data: {
        sessions: sessionsCreated,
        count: sessionsCreated.length,
        rejected,
        orchestrationMode: "solo",
      },
    });
  } catch (e) {
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code?: string }).code === "AGENT_ALREADY_RUNNING"
    ) {
      return NextResponse.json(e, { status: 409 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Build launch failed" },
      { status: 500 }
    );
  }
}
