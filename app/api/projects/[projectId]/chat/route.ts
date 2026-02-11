import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatMessages, projects, documents, settings } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { spawnClaude } from "@/lib/claude/spawn";
import { buildChatPrompt } from "@/lib/claude/prompt-builder";
import { parseClaudeOutput } from "@/lib/claude/json-parser";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const messages = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.projectId, projectId))
    .orderBy(chatMessages.createdAt)
    .all();

  return NextResponse.json({ data: messages });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json();

  if (!body.content) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  // Save user message
  const userMsgId = createId();
  db.insert(chatMessages)
    .values({
      id: userMsgId,
      projectId,
      role: "user",
      content: body.content,
      createdAt: new Date().toISOString(),
    })
    .run();

  // Load context
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const docs = db.select().from(documents).where(eq(documents.projectId, projectId)).all();
  const recentMessages = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.projectId, projectId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(20)
    .all()
    .reverse();

  // Get global prompt from settings
  const settingsRow = db.select().from(settings).where(eq(settings.key, "global_prompt")).get();
  const globalPrompt = settingsRow ? JSON.parse(settingsRow.value) : "";

  const prompt = buildChatPrompt(
    project,
    docs,
    recentMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    globalPrompt
  );

  try {
    console.log("[chat] Spawning Claude CLI, cwd:", project.gitRepoPath || "(none)");

    const { promise } = spawnClaude({
      mode: "plan",
      prompt,
      cwd: project.gitRepoPath || undefined,
    });

    const result = await promise;

    console.log("[chat] Claude CLI result:", {
      success: result.success,
      duration: result.duration,
      error: result.error,
      resultLength: result.result?.length ?? 0,
      resultPreview: result.result?.slice(0, 300),
    });

    if (!result.success) {
      // Save error as assistant message
      const errorMsgId = createId();
      db.insert(chatMessages)
        .values({
          id: errorMsgId,
          projectId,
          role: "assistant",
          content: `Error: ${result.error || "Claude Code failed"}`,
          createdAt: new Date().toISOString(),
        })
        .run();

      return NextResponse.json({ data: { userMessage: userMsgId, assistantMessage: errorMsgId } });
    }

    const parsed = parseClaudeOutput(result.result || "");

    const assistantMsgId = createId();
    db.insert(chatMessages)
      .values({
        id: assistantMsgId,
        projectId,
        role: "assistant",
        content: parsed.content,
        metadata: JSON.stringify(parsed.metadata || {}),
        createdAt: new Date().toISOString(),
      })
      .run();

    return NextResponse.json({ data: { userMessage: userMsgId, assistantMessage: assistantMsgId } });
  } catch (e) {
    const errorMsgId = createId();
    db.insert(chatMessages)
      .values({
        id: errorMsgId,
        projectId,
        role: "assistant",
        content: `Error: ${e instanceof Error ? e.message : "Unknown error"}`,
        createdAt: new Date().toISOString(),
      })
      .run();

    return NextResponse.json({ data: { userMessage: userMsgId, assistantMessage: errorMsgId } });
  }
}
