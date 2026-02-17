import { NextRequest, NextResponse } from "next/server";
import { importGitHubIssuesAsTickets } from "@/lib/github/issues";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const issueNumbers = Array.isArray(body?.issueNumbers)
    ? body.issueNumbers.filter((value: unknown) => Number.isInteger(value))
    : [];

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to import issues." },
      { status: 500 }
    );
  }
}
