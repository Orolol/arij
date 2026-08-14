import { NextResponse } from "next/server";
import { listGlobalAgentProviders } from "@/lib/agent-config/agent-resolution";
import { errorResponse } from "@/lib/api/route-helpers";

export async function GET() {
  try {
    const data = await listGlobalAgentProviders();
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error, "Failed to load provider defaults");
  }
}
