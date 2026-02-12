import { NextRequest, NextResponse } from "next/server";
import { createId } from "@/lib/utils/nanoid";
import {
  createCustomReviewAgent,
  listGlobalCustomReviewAgents,
} from "@/lib/agent-config/review-agents";

export async function GET() {
  try {
    const data = await listGlobalCustomReviewAgents();
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load review agents" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const systemPrompt =
    typeof body.systemPrompt === "string" ? body.systemPrompt : "";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!systemPrompt) {
    return NextResponse.json(
      { error: "systemPrompt is required" },
      { status: 400 }
    );
  }

  const created = await createCustomReviewAgent({
    id: createId(),
    name,
    systemPrompt,
    scope: "global",
  });

  if (!created) {
    return NextResponse.json(
      { error: "name already exists in this scope" },
      { status: 409 }
    );
  }

  return NextResponse.json({ data: created }, { status: 201 });
}
