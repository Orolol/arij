import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentPrompts, projects } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { isAgentType } from "@/lib/agent-config/constants";

type Params = { params: Promise<{ projectId: string; agentType: string }> };

async function validateProject(projectId: string) {
  return db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { projectId, agentType } = await params;
  if (!isAgentType(agentType)) {
    return NextResponse.json({ error: `Unknown agent type: ${agentType}` }, { status: 400 });
  }

  const project = await validateProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt : null;
  if (systemPrompt == null) {
    return NextResponse.json(
      { error: "systemPrompt string is required" },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const existing = db
    .select({
      id: agentPrompts.id,
    })
    .from(agentPrompts)
    .where(
      and(eq(agentPrompts.agentType, agentType), eq(agentPrompts.scope, projectId))
    )
    .get();

  if (existing) {
    db.update(agentPrompts)
      .set({ systemPrompt, updatedAt: now })
      .where(eq(agentPrompts.id, existing.id))
      .run();
  } else {
    db.insert(agentPrompts)
      .values({
        id: createId(),
        agentType,
        systemPrompt,
        scope: projectId,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const updated = db
    .select()
    .from(agentPrompts)
    .where(
      and(eq(agentPrompts.agentType, agentType), eq(agentPrompts.scope, projectId))
    )
    .get();

  return NextResponse.json({ data: updated });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { projectId, agentType } = await params;
  if (!isAgentType(agentType)) {
    return NextResponse.json({ error: `Unknown agent type: ${agentType}` }, { status: 400 });
  }

  const project = await validateProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const result = db
    .delete(agentPrompts)
    .where(
      and(eq(agentPrompts.agentType, agentType), eq(agentPrompts.scope, projectId))
    )
    .run();

  return NextResponse.json({
    data: {
      deleted: result.changes > 0,
    },
  });
}
