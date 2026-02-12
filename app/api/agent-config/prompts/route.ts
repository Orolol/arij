import { NextResponse } from "next/server";
import { listGlobalAgentPrompts } from "@/lib/agent-config/prompts";

export async function GET() {
  try {
    const data = await listGlobalAgentPrompts();
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load agent prompts" },
      { status: 500 }
    );
  }
}
