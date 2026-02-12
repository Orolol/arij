import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects, documents, settings, chatMessages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
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

  const conversationId: string | null = body.conversationId || null;

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

    // Persist user + assistant messages when conversationId is provided
    if (conversationId) {
      const now = new Date().toISOString();
      const lastUserMsg = body.messages[body.messages.length - 1];
      if (lastUserMsg && lastUserMsg.role === "user") {
        db.insert(chatMessages)
          .values({
            id: createId(),
            projectId,
            conversationId,
            role: "user",
            content: lastUserMsg.content,
            createdAt: now,
          })
          .run();
      }
      db.insert(chatMessages)
        .values({
          id: createId(),
          projectId,
          conversationId,
          role: "assistant",
          content: parsed.content,
          createdAt: now,
        })
        .run();
    }

    return NextResponse.json({ data: { content: parsed.content } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
