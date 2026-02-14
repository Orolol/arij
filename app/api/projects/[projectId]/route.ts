import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { tryExportArjiJson } from "@/lib/sync/export";
import { updateProjectSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import { validatePath } from "@/lib/validation/path";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({ data: project });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const validated = await validateBody(updateProjectSchema, request);
  if (isValidationError(validated)) return validated;

  const existing = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = validated.data;

  // Validate gitRepoPath if provided
  if (body.gitRepoPath) {
    const pathResult = await validatePath(body.gitRepoPath);
    if (!pathResult.valid) {
      return NextResponse.json(
        { error: pathResult.error },
        { status: 400 }
      );
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.status !== undefined) updates.status = body.status;
  if (body.gitRepoPath !== undefined) updates.gitRepoPath = body.gitRepoPath;
  if (body.githubOwnerRepo !== undefined) updates.githubOwnerRepo = body.githubOwnerRepo;
  if (body.spec !== undefined) updates.spec = body.spec;

  db.update(projects).set(updates).where(eq(projects.id, projectId)).run();

  const updated = db.select().from(projects).where(eq(projects.id, projectId)).get();
  tryExportArjiJson(projectId);
  return NextResponse.json({ data: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const existing = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  db.delete(projects).where(eq(projects.id, projectId)).run();
  return NextResponse.json({ data: { deleted: true } });
}
