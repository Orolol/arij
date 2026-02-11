import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, documents, epics, userStories, settings } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { spawnClaude } from "@/lib/claude/spawn";
import { buildEpicCreationPrompt } from "@/lib/claude/prompt-builder";
import { extractJsonFromOutput } from "@/lib/claude/json-parser";
import { tryExportArjiJson } from "@/lib/sync/export";

interface EpicCreationResult {
  title: string;
  description?: string;
  priority?: number;
  user_stories?: Array<{
    title: string;
    description?: string;
    acceptance_criteria?: string;
  }>;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json();

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const docs = db.select().from(documents).where(eq(documents.projectId, projectId)).all();

  const settingsRow = db.select().from(settings).where(eq(settings.key, "global_prompt")).get();
  const globalPrompt = settingsRow ? JSON.parse(settingsRow.value) : "";

  const prompt = buildEpicCreationPrompt(
    project,
    docs,
    body.messages.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    globalPrompt,
  );

  try {
    console.log("[epic-create] Spawning Claude CLI, cwd:", project.gitRepoPath || "(none)");

    const { promise } = spawnClaude({
      mode: "plan",
      prompt,
      cwd: project.gitRepoPath || undefined,
    });

    const result = await promise;

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Claude Code failed" },
        { status: 500 },
      );
    }

    const epicData = extractJsonFromOutput<EpicCreationResult>(result.result || "");

    if (!epicData || !epicData.title) {
      return NextResponse.json(
        { error: "Failed to parse epic data from Claude response" },
        { status: 500 },
      );
    }

    // Compute max position for backlog epics
    const maxPos = db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(epics)
      .where(and(eq(epics.projectId, projectId), eq(epics.status, "backlog")))
      .get();

    const epicId = createId();
    const now = new Date().toISOString();

    db.insert(epics)
      .values({
        id: epicId,
        projectId,
        title: epicData.title,
        description: epicData.description || null,
        priority: epicData.priority ?? 1,
        status: "backlog",
        position: (maxPos?.max ?? -1) + 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    let userStoriesCreated = 0;

    if (epicData.user_stories) {
      for (let j = 0; j < epicData.user_stories.length; j++) {
        const usData = epicData.user_stories[j];
        db.insert(userStories)
          .values({
            id: createId(),
            epicId,
            title: usData.title,
            description: usData.description || null,
            acceptanceCriteria: usData.acceptance_criteria || null,
            status: "todo",
            position: j,
            createdAt: now,
          })
          .run();
        userStoriesCreated++;
      }
    }

    tryExportArjiJson(projectId);
    return NextResponse.json({
      data: {
        epicId,
        title: epicData.title,
        userStoriesCreated,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
