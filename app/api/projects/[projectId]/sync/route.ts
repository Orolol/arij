import { NextRequest, NextResponse } from "next/server";
import {
  getProjectOr404,
  isErrorResponse,
  errorResponse,
} from "@/lib/api/route-helpers";
import { exportArjiJson } from "@/lib/sync/export";
import { importArjiJson } from "@/lib/sync/import";
import { syncProjectSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const validated = await validateBody(syncProjectSchema, request);
  if (isValidationError(validated)) return validated;
  const { action } = validated.data;

  const found = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(found)) return found;
  const { project } = found;

  try {
    if (action === "export") {
      await exportArjiJson(projectId);
      return NextResponse.json({
        data: { action, path: project.gitRepoPath },
      });
    }

    // action === "import"
    const summary = await importArjiJson(projectId);
    return NextResponse.json({ data: { action, summary } });
  } catch (error) {
    return errorResponse(error, "Sync failed");
  }
}
