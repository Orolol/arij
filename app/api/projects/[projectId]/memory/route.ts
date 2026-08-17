import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import {
  getProjectMemoryDoc,
  saveProjectMemory,
} from "@/lib/documents/memory";
import { PROJECT_MEMORY_MAX_CHARS } from "@/lib/documents/memory-constants";

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET /api/projects/[projectId]/memory
 *
 * The project's learned-memory document (see lib/documents/memory.ts).
 * `content` is an empty string when no memory document exists yet — the
 * Docs-tab editor treats "absent" and "empty" identically.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const doc = getProjectMemoryDoc(projectId);

  return NextResponse.json({
    data: {
      content: doc?.markdownContent ?? "",
      exists: !!doc,
      updatedAt: doc?.updatedAt ?? null,
      maxChars: PROJECT_MEMORY_MAX_CHARS,
    },
  });
}

const putMemorySchema = z.object({
  // The manual editor REJECTS oversized input (unlike the distillation flow,
  // which truncates) so a hand-written doc is never silently cut.
  content: z
    .string()
    .max(
      PROJECT_MEMORY_MAX_CHARS,
      `Project memory must stay under ${PROJECT_MEMORY_MAX_CHARS} characters`
    ),
});

/**
 * PUT /api/projects/[projectId]/memory
 *
 * Creates or replaces the memory document with the given markdown body.
 * An empty string is valid: it clears the memory (the prompt section is
 * omitted for empty content, so agents simply stop seeing it).
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const validated = await validateBody(putMemorySchema, request);
  if (isValidationError(validated)) return validated;

  const { doc } = saveProjectMemory(projectId, validated.data.content);

  return NextResponse.json({
    data: {
      content: doc.markdownContent ?? "",
      exists: true,
      updatedAt: doc.updatedAt ?? null,
      maxChars: PROJECT_MEMORY_MAX_CHARS,
    },
  });
}
