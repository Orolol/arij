import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, documents, settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { spawnClaude } from "@/lib/claude/spawn";
import { buildEpicRefinementPrompt } from "@/lib/claude/prompt-builder";
import { parseClaudeOutput } from "@/lib/claude/json-parser";

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

  const prompt = buildEpicRefinementPrompt(
    project,
    docs,
    body.messages.map((m: { role: string; content: string }) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    globalPrompt,
  );

  try {
    console.log("[epic-chat] Spawning Claude CLI, cwd:", project.gitRepoPath || "(none)");

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

    const parsed = parseClaudeOutput(result.result || "");

    return NextResponse.json({ data: { content: parsed.content } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
