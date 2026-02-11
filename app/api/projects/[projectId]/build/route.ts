import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  projects,
  epics,
  userStories,
  documents,
  agentSessions,
  settings,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { createWorktree, isGitRepo } from "@/lib/git/manager";
import { processManager } from "@/lib/claude/process-manager";
import { buildBuildPrompt } from "@/lib/claude/prompt-builder";
import fs from "fs";
import path from "path";
import { tryExportArjiJson } from "@/lib/sync/export";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json();
  const { epicIds, mode = "parallel" } = body as {
    epicIds: string[];
    mode?: "sequential" | "parallel";
  };

  if (!epicIds || !Array.isArray(epicIds) || epicIds.length === 0) {
    return NextResponse.json(
      { error: "epicIds array is required" },
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

  const settingsRow = db
    .select()
    .from(settings)
    .where(eq(settings.key, "global_prompt"))
    .get();
  const globalPrompt = settingsRow ? JSON.parse(settingsRow.value) : "";

  const sessionsCreated: string[] = [];
  const projectRef = project;

  async function launchEpic(epicId: string) {
    const epic = db.select().from(epics).where(eq(epics.id, epicId)).get();
    if (!epic) return;

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
      globalPrompt
    );

    // Create session in DB
    const sessionId = createId();
    const now = new Date().toISOString();
    const logsDir = path.join(process.cwd(), "data", "sessions", sessionId);
    fs.mkdirSync(logsDir, { recursive: true });
    const logsPath = path.join(logsDir, "logs.json");

    db.insert(agentSessions)
      .values({
        id: sessionId,
        projectId,
        epicId,
        status: "running",
        mode: "code",
        prompt,
        logsPath,
        branchName,
        worktreePath,
        startedAt: now,
        createdAt: now,
      })
      .run();

    // Move epic to in_progress
    db.update(epics)
      .set({ status: "in_progress", branchName, updatedAt: now })
      .where(eq(epics.id, epicId))
      .run();

    // Update project status to building
    db.update(projects)
      .set({ status: "building", updatedAt: now })
      .where(eq(projects.id, projectId))
      .run();

    // Spawn Claude Code
    const sessionInfo = processManager.start(sessionId, {
      mode: "code",
      prompt,
      cwd: worktreePath,
      allowedTools: ["Edit", "Write", "Bash", "Read", "Glob", "Grep"],
    });

    // Background: wait for completion and update DB
    (async () => {
      // Poll until done
      let info = processManager.getStatus(sessionId);
      while (info && info.status === "running") {
        await new Promise((r) => setTimeout(r, 2000));
        info = processManager.getStatus(sessionId);
      }

      const completedAt = new Date().toISOString();
      const result = info?.result;

      // Write logs
      try {
        fs.writeFileSync(logsPath, JSON.stringify(result, null, 2));
      } catch {
        // ignore
      }

      // Update session in DB
      db.update(agentSessions)
        .set({
          status: result?.success ? "completed" : "failed",
          completedAt,
          error: result?.error || null,
        })
        .where(eq(agentSessions.id, sessionId))
        .run();

      // Move epic to review if successful
      if (result?.success) {
        db.update(epics)
          .set({ status: "review", updatedAt: completedAt })
          .where(eq(epics.id, epicId))
          .run();
      }
    })();

    sessionsCreated.push(sessionId);
  }

  try {
    if (mode === "sequential") {
      for (const epicId of epicIds) {
        await launchEpic(epicId);
      }
    } else {
      await Promise.all(epicIds.map(launchEpic));
    }

    tryExportArjiJson(projectId);
    return NextResponse.json({
      data: {
        sessions: sessionsCreated,
        count: sessionsCreated.length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Build launch failed" },
      { status: 500 }
    );
  }
}
