import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/route-helpers";
import { syncProjectGitHubIssues } from "@/lib/github/issues";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  try {
    const result = await syncProjectGitHubIssues(projectId);
    return NextResponse.json({ data: result });
  } catch (error) {
    return errorResponse(error, "Failed to sync GitHub issues.");
  }
}
