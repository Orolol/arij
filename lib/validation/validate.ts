import { NextRequest, NextResponse } from "next/server";
import { ZodSchema } from "zod";

export async function validateBody<T>(
  schema: ZodSchema<T>,
  request: NextRequest
): Promise<{ data: T } | NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        details: result.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  return { data: result.data };
}

/** Type guard: returns true when the result is a NextResponse (validation error) */
export function isValidationError<T>(
  result: { data: T } | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}
