import { NextRequest, NextResponse } from "next/server";
import {
  isGitHubIssueSyncDue,
  listTriagedIssues,
  syncProjectGitHubIssues,
} from "@/lib/github/issues";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  try {
    if (isGitHubIssueSyncDue(projectId, 15)) {
      await syncProjectGitHubIssues(projectId);
    }

    const label = request.nextUrl.searchParams.get("label");
    const milestone = request.nextUrl.searchParams.get("milestone");
    const data = listTriagedIssues(projectId, { label, milestone });

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load triage issues." },
      { status: 500 }
    );
  }
}
