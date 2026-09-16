import { NextRequest, NextResponse } from "next/server";
import { ZodSchema } from "zod";

/**
 * The one body-validation path. A route that hand-parses `request.json()` and
 * checks fields itself produces a different error shape from every other route
 * (`apiErrorMessage` on the client expects `{ error: "Validation failed",
 * details }`), which is why the shared entry points below exist.
 */
function parseAndValidate<T>(
  raw: string,
  schema: ZodSchema<T>
): { data: T } | NextResponse {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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

async function readRawBody(request: NextRequest): Promise<string> {
  if (typeof request.text === "function") {
    return await request.text().catch(() => "");
  }
  if (typeof request.json === "function") {
    try {
      const data = await request.json();
      return JSON.stringify(data);
    } catch {
      return "";
    }
  }
  return "";
}

export async function validateBody<T>(
  schema: ZodSchema<T>,
  request: NextRequest
): Promise<{ data: T } | NextResponse> {
  return parseAndValidate(await readRawBody(request), schema);
}

/** Type guard: returns true when the result is a NextResponse (validation error) */
export function isValidationError<T>(
  result: { data: T } | NextResponse
): result is NextResponse {
  return result instanceof NextResponse;
}

/**
 * Like {@link validateBody}, but tolerates a POST with no body at all.
 *
 * A route whose schema has no required field (`POST .../device/start`) would
 * otherwise 400 on `fetch(url, { method: "POST" })` — the most natural way to
 * call it — because the body is empty. An ABSENT body validates as `{}`; a
 * body that is present but malformed is still a 400, since that is a client
 * bug worth reporting rather than swallowing.
 */
export async function validateOptionalBody<T>(
  schema: ZodSchema<T>,
  request: NextRequest
): Promise<{ data: T } | NextResponse> {
  const raw = await readRawBody(request);
  return parseAndValidate(raw.trim().length === 0 ? "{}" : raw, schema);
}
