import { NextResponse } from "next/server";
import { listGlobalAgentPrompts } from "@/lib/agent-config/prompts";
import { errorResponse } from "@/lib/api/route-helpers";

export async function GET() {
  try {
    const data = await listGlobalAgentPrompts();
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error, "Failed to load agent prompts");
  }
}
