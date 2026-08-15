import { NextRequest, NextResponse } from "next/server";
import { createId } from "@/lib/utils/nanoid";
import {
  createCustomReviewAgent,
  listGlobalCustomReviewAgents,
} from "@/lib/agent-config/review-agents";
import { errorResponse } from "@/lib/api/route-helpers";
import { createReviewAgentSchema } from "@/lib/validation/schemas";
import { validateBody, isValidationError } from "@/lib/validation/validate";

export async function GET() {
  try {
    const data = await listGlobalCustomReviewAgents();
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error, "Failed to load review agents");
  }
}

export async function POST(request: NextRequest) {
  const validated = await validateBody(createReviewAgentSchema, request);
  if (isValidationError(validated)) return validated;

  const name = validated.data.name.trim();
  const { systemPrompt } = validated.data;

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
