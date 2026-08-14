import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api/route-helpers";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import { importGitHubIssuesAsTickets } from "@/lib/github/issues";

const importBodySchema = z.object({
  issueNumbers: z.array(z.number().int()).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const validated = await validateBody(importBodySchema, request);
  if (isValidationError(validated)) return validated;
  const issueNumbers = validated.data.issueNumbers ?? [];

  if (issueNumbers.length === 0) {
    return NextResponse.json(
      { error: "issueNumbers is required" },
      { status: 400 }
    );
  }

  try {
    const imported = importGitHubIssuesAsTickets(projectId, issueNumbers);
    return NextResponse.json({ data: { imported } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "Failed to import issues.");
  }
}
