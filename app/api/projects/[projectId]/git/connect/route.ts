import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  getProjectOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import { validateBody, isValidationError } from "@/lib/validation/validate";

const connectBodySchema = z.object({
  ownerRepo: z.string(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const validated = await validateBody(connectBodySchema, request);
  if (isValidationError(validated)) return validated;
  const { ownerRepo } = validated.data;

  // Validate format
  const parts = ownerRepo.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return NextResponse.json(
      { error: "ownerRepo must be in 'owner/repo' format." },
      { status: 400 }
    );
  }

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  db.update(projects)
    .set({
      githubOwnerRepo: ownerRepo,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(projects.id, projectId))
    .run();

  const updated = db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();

  return NextResponse.json({ data: updated });
}
