import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  epics,
  userStories,
  documents,
} from "@/lib/db/schema";
import { eq, and, notInArray } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { createWorktree, isGitRepo } from "@/lib/git/manager";
import { processManager } from "@/lib/claude/process-manager";
import {
  buildBuildPrompt,
  buildTeamBuildPrompt,
  type TeamEpic,
} from "@/lib/claude/prompt-builder";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import type { ProviderType } from "@/lib/providers";
import fs from "fs";
import path from "path";
import { tryExportArjiJson } from "@/lib/sync/export";
import {
  createAgentAlreadyRunningPayload,
  getRunningSessionForTarget,
  insertRunningSessionWithGuard,
} from "@/lib/agents/concurrency";
import {
  createQueuedSession,
  isSessionLifecycleConflictError,
  markSessionRunning,
  markSessionTerminal,
} from "@/lib/agent-sessions/lifecycle";
import {
  buildExecutionPlan,
  executeDagPlan,
  type LayerResult,
} from "@/lib/dependencies/scheduler";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json();
  const {
    epicIds,
    mode = "parallel",
    team = false,
    provider = "claude-code",
  } = body as {
    epicIds: string[];
    mode?: "sequential" | "parallel";
    team?: boolean;
    provider?: ProviderType;
  };

  if (!epicIds || !Array.isArray(epicIds) || epicIds.length === 0) {
    return NextResponse.json(
      { error: "epicIds array is required" },
      { status: 400 }
    );
  }

  // Conflict check up-front so batch launches fail fast with a deterministic payload.
  for (const epicId of epicIds) {
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

  // Team mode is Claude Code exclusive — Codex has no Task tool
  if (team && provider === "codex") {
    return NextResponse.json(
      { error: "Team mode is only available with Claude Code. Codex does not support sub-agent delegation." },
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

  const isRepo = await isGitRepo(gitRepoPath);
  if (!isRepo) {
    return NextResponse.json(
      { error: `Path is not a git repository: ${gitRepoPath}` },
      { status: 400 }
    );
  }

  // Load project context
  const docs = db
    .select()
    .from(documents)
    .where(eq(documents.projectId, projectId))
    .all();
  const buildSystemPrompt = await resolveAgentPrompt("build", projectId);
  const teamBuildSystemPrompt = await resolveAgentPrompt(
    "team_build",
    projectId
  );

  const sessionsCreated: string[] = [];
  const projectRef = project;

  // -----------------------------------------------------------------------
  // TEAM MODE — single CC session managing multiple epics via Task tool
  // -----------------------------------------------------------------------
  if (team) {
    try {
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
          epic.title
        );

        teamEpics.push({
          title: epic.title,
          description: epic.description,
          worktreePath,
          userStories: us,
        });

        epicRecords.push({ id: epicId, branchName });

        // Move epic to in_progress
        const now = new Date().toISOString();
        db.update(epics)
          .set({ status: "in_progress", branchName, updatedAt: now })
          .where(eq(epics.id, epicId))
          .run();
      }

      // Build team prompt
      const prompt = buildTeamBuildPrompt(
        projectRef,
        docs,
        teamEpics,
        teamBuildSystemPrompt
      );

      // Create single team session
      const sessionId = createId();
      const now = new Date().toISOString();
      const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
      fs.mkdirSync(logsDir, { recursive: true });
      const logsPath = path.join(logsDir, "logs.json");

      createQueuedSession({
        id: sessionId,
        projectId,
        mode: "code",
        orchestrationMode: "team",
        provider: "claude-code",
        prompt,
        logsPath,
        createdAt: now,
      });

      // Update project status
      db.update(projects)
        .set({ status: "building", updatedAt: now })
        .where(eq(projects.id, projectId))
        .run();

      // Spawn single CC session from main repo root with Task in allowedTools
      markSessionRunning(sessionId, now);
      processManager.start(sessionId, {
        mode: "code",
        prompt,
        cwd: gitRepoPath,
        allowedTools: [
          "Edit",
          "Write",
          "Bash",
          "Read",
          "Glob",
          "Grep",
          "Task",
        ],
      });

      // Background: wait for completion, update all epic statuses
      const allEpicIds = epicRecords.map((e) => e.id);
      (async () => {
        let info = processManager.getStatus(sessionId);
        while (info && info.status === "running") {
          await new Promise((r) => setTimeout(r, 2000));
          info = processManager.getStatus(sessionId);
        }

        const completedAt = new Date().toISOString();
        const result = info?.result;

        try {
          fs.writeFileSync(logsPath, JSON.stringify(result, null, 2));
        } catch {
          // ignore
        }

        try {
          markSessionTerminal(
            sessionId,
            {
              success: !!result?.success,
              error: result?.error || null,
            },
            completedAt
          );
        } catch (error) {
          if (!isSessionLifecycleConflictError(error)) {
            console.error("[build/team] Failed to finalize session", error);
          }
        }

        // Update all associated epics
        if (result?.success) {
          for (const eid of allEpicIds) {
            db.update(epics)
              .set({ status: "review", updatedAt: completedAt })
              .where(eq(epics.id, eid))
              .run();
          }
        }
      })();

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
        { status: 500 }
      );
    }
  }

  // -----------------------------------------------------------------------
  // SOLO MODE — one session per epic
  // -----------------------------------------------------------------------

  /**
   * Launch a single epic build agent.
   * Returns the sessionId without waiting for completion.
   */
  async function spawnEpicBuild(epicId: string): Promise<string> {
    const epic = db.select().from(epics).where(eq(epics.id, epicId)).get();
    if (!epic) throw new Error(`Epic not found: ${epicId}`);

    const us = db
      .select()
      .from(userStories)
      .where(eq(userStories.epicId, epicId))
      .orderBy(userStories.position)
      .all();

    // Create worktree + branch
    const { worktreePath, branchName } = await createWorktree(
      gitRepoPath,
      epic.id,
      epic.title
    );

    // Compose prompt
    const prompt = buildBuildPrompt(
      projectRef,
      docs,
      epic,
      us,
      buildSystemPrompt
    );

    // Create session in DB
    const sessionId = createId();
    const now = new Date().toISOString();
    const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
    fs.mkdirSync(logsDir, { recursive: true });
    const logsPath = path.join(logsDir, "logs.json");

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

    createQueuedSession({
      id: sessionId,
      projectId,
      epicId,
      mode: "code",
      orchestrationMode: "solo",
      provider,
      prompt,
      logsPath,
      branchName,
      worktreePath,
      createdAt: now,
    });

    // Move epic to in_progress
    db.update(epics)
      .set({ status: "in_progress", branchName, updatedAt: now })
      .where(eq(epics.id, epicId))
      .run();

    // Sync US statuses: non-done -> in_progress
    db.update(userStories)
      .set({ status: "in_progress" })
      .where(
        and(
          eq(userStories.epicId, epicId),
          notInArray(userStories.status, ["done"])
        )
      )
      .run();

    // Update project status to building
    db.update(projects)
      .set({ status: "building", updatedAt: now })
      .where(eq(projects.id, projectId))
      .run();

    // Spawn agent via process manager
    markSessionRunning(sessionId, now);
    processManager.start(sessionId, {
      mode: "code",
      prompt,
      cwd: worktreePath,
      allowedTools: ["Edit", "Write", "Bash", "Read", "Glob", "Grep"],
    }, provider);

    sessionsCreated.push(sessionId);
    return sessionId;
  }

  /**
   * Wait for a session to finish and finalize its DB state.
   * Returns whether the session was successful.
   */
  async function waitAndFinalize(
    sessionId: string,
    epicId: string
  ): Promise<{ success: boolean; error?: string }> {
    let info = processManager.getStatus(sessionId);
    while (info && info.status === "running") {
      await new Promise((r) => setTimeout(r, 2000));
      info = processManager.getStatus(sessionId);
    }

    const completedAt = new Date().toISOString();
    const result = info?.result;

    try {
      const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
      const logsPath = path.join(logsDir, "logs.json");
      fs.writeFileSync(logsPath, JSON.stringify(result, null, 2));
    } catch {
      // ignore
    }

    try {
      markSessionTerminal(
        sessionId,
        {
          success: !!result?.success,
          error: result?.error || null,
        },
        completedAt
      );
    } catch (error) {
      if (!isSessionLifecycleConflictError(error)) {
        console.error("[build/solo] Failed to finalize session", error);
      }
    }

    // Move epic + US to review if successful
    if (result?.success) {
      db.update(userStories)
        .set({ status: "review" })
        .where(
          and(
            eq(userStories.epicId, epicId),
            eq(userStories.status, "in_progress")
          )
        )
        .run();

      db.update(epics)
        .set({ status: "review", updatedAt: completedAt })
        .where(eq(epics.id, epicId))
        .run();
    }

    return {
      success: !!result?.success,
      error: result?.error || undefined,
    };
  }

  /**
   * Launch an epic and wait for it to finish (used by DAG scheduler).
   */
  async function launchAndWait(epicId: string): Promise<LayerResult> {
    const sessionId = await spawnEpicBuild(epicId);
    const result = await waitAndFinalize(sessionId, epicId);
    return { epicId, sessionId, ...result };
  }

  try {
    // Build a DAG execution plan so dependencies are respected.
    // Epics in the same topological layer launch concurrently;
    // the next layer starts only after the previous layer finishes.
    const plan = buildExecutionPlan(projectId, epicIds);
    const hasDependencies = plan.layers.length > 1;

    if (hasDependencies) {
      // DAG-aware execution: layer-by-layer in the background
      const planLayers = plan.layers.map((layer) => [...layer]);
      (async () => {
        try {
          await executeDagPlan(projectId, plan, launchAndWait);
        } catch (e) {
          console.error("[build/dag] DAG execution error", e);
        }
      })();

      tryExportArjiJson(projectId);
      return NextResponse.json({
        data: {
          sessions: sessionsCreated,
          count: epicIds.length,
          orchestrationMode: "dag",
          dagPlan: { layers: planLayers },
        },
      });
    }

    // No dependencies — launch all at once with background finalization
    if (mode === "sequential") {
      for (const epicId of epicIds) {
        await spawnEpicBuild(epicId);
      }
    } else {
      await Promise.all(epicIds.map(spawnEpicBuild));
    }

    // Background finalization for each session
    for (let i = 0; i < sessionsCreated.length; i++) {
      const sessionId = sessionsCreated[i];
      const epicId = epicIds[i];
      (async () => {
        await waitAndFinalize(sessionId, epicId);
      })();
    }

    tryExportArjiJson(projectId);
    return NextResponse.json({
      data: {
        sessions: sessionsCreated,
        count: sessionsCreated.length,
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
