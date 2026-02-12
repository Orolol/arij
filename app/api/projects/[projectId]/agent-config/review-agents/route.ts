import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import {
  createCustomReviewAgent,
  listMergedCustomReviewAgents,
} from "@/lib/agent-config/review-agents";

type Params = { params: Promise<{ projectId: string }> };

async function ensureProject(projectId: string) {
  return db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = await ensureProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const data = await listMergedCustomReviewAgents(projectId);
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest, { params }: Params) {
  const { projectId } = await params;
  const project = await ensureProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const systemPrompt =
    typeof body.systemPrompt === "string" ? body.systemPrompt : "";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!systemPrompt) {
    return NextResponse.json(
      { error: "systemPrompt is required" },
      { status: 400 }
    );
  }

  const created = await createCustomReviewAgent({
    id: createId(),
    name,
    systemPrompt,
    scope: projectId,
  });
  if (!created) {
    return NextResponse.json(
      { error: "name already exists in this scope" },
      { status: 409 }
    );
  }

  return NextResponse.json({ data: created }, { status: 201 });
}
