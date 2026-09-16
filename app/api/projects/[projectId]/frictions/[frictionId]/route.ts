import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { frictions } from "@/lib/db/schema";
import { OPEN_FRICTION_STATUSES } from "@/lib/frictions/constants";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { isValidationError, validateBody } from "@/lib/validation/validate";

const updateFrictionSchema = z.object({ status: z.enum(["triaged", "dismissed"]) }).strict();

/** Update an open friction (triage or dismiss) without touching tickets or comments. */
export async function PATCH(
  request: NextRequest,
  {
    params,
  }: { params: Promise<{ projectId: string; frictionId: string }> },
) {
  const { projectId, frictionId } = await params;
  const foundProject = getProjectOr404(projectId);
  if (isErrorResponse(foundProject)) return foundProject;

  const validated = await validateBody(updateFrictionSchema, request);
  if (isValidationError(validated)) return validated;

  const friction = db
    .select({ id: frictions.id, status: frictions.status })
    .from(frictions)
    .where(and(eq(frictions.id, frictionId), eq(frictions.projectId, projectId)))
    .get();

  if (!friction) {
    return NextResponse.json({ error: "Friction not found" }, { status: 404 });
  }

  const result = db
    .update(frictions)
    .set({ status: validated.data.status })
    .where(
      and(
        eq(frictions.id, frictionId),
        eq(frictions.projectId, projectId),
        inArray(frictions.status, [...OPEN_FRICTION_STATUSES]),
      ),
    )
    .run();

  if (result.changes !== 1) {
    return NextResponse.json(
      { error: "Only an open friction can be updated", code: "FRICTION_CLOSED" },
      { status: 409 },
    );
  }

  return NextResponse.json({
    data: db.select().from(frictions).where(eq(frictions.id, frictionId)).get(),
  });
}
/** Permanently delete a friction row. */
export async function DELETE(
  _request: NextRequest,
  {
    params,
  }: { params: Promise<{ projectId: string; frictionId: string }> },
) {
  const { projectId, frictionId } = await params;
  const foundProject = getProjectOr404(projectId);
  if (isErrorResponse(foundProject)) return foundProject;

  const result = db
    .delete(frictions)
    .where(and(eq(frictions.id, frictionId), eq(frictions.projectId, projectId)))
    .run();

  if (result.changes === 0) {
    return NextResponse.json({ error: "Friction not found" }, { status: 404 });
  }

  return NextResponse.json({ data: { success: true } });
}
