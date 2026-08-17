import { NextRequest, NextResponse } from "next/server";
import {
  getAgentReliabilityStats,
  getReviewBounceStats,
} from "@/lib/agent-config/stats";

/**
 * GET /api/agent-config/stats[?projectId=...]
 *
 * Read-only reliability & cost aggregates for the Agent Config "Stats" tab:
 * per named agent × provider run counts / success rate / median duration /
 * total cost, plus per-project review bounce rates. The optional projectId
 * query param scopes both to one project.
 */
export async function GET(request: NextRequest) {
  const projectId =
    request.nextUrl.searchParams.get("projectId")?.trim() || undefined;

  try {
    return NextResponse.json({
      data: {
        agents: getAgentReliabilityStats(projectId),
        reviewBounce: getReviewBounceStats(projectId),
      },
    });
  } catch (error) {
    // Inline (not errorResponse) to match the other agent-config routes:
    // data access goes through lib/agent-config/stats, not route-helpers.
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load agent stats",
      },
      { status: 500 },
    );
  }
}
