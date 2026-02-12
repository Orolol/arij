import { NextResponse } from "next/server";
import { listGlobalAgentProviders } from "@/lib/agent-config/providers";

export async function GET() {
  try {
    const data = await listGlobalAgentProviders();
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load provider defaults" },
      { status: 500 }
    );
  }
}
