import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import {
  getProjectMemoryDoc,
  isProjectMemoryChangedError,
  saveProjectMemoryGuarded,
} from "@/lib/documents/memory";
import { buildMemoryEnvelope } from "@/lib/documents/memory-envelope";
import {
  PROJECT_MEMORY_MAX_CHARS,
  PROJECT_MEMORY_MAX_TOKENS,
} from "@/lib/documents/memory-constants";
import { recordMemoryWriteProvenance } from "@/lib/documents/memory-provenance";
import { eventBus } from "@/lib/events/bus";

type Params = { params: Promise<{ projectId: string }> };

/**
 * GET /api/projects/[projectId]/memory
 *
 * The project's learned-memory document (see lib/documents/memory.ts).
 * `content` is an empty string when no memory document exists yet — the
 * memory panel treats "absent" and "empty" identically.
 *
 * `provenance` tells WHO wrote the document last (Story 3 of the "gérer la
 * section mémoire" epic), `archive` dates the one pre-dream snapshot the
 * panel can restore from (its text: GET /memory/restore), and `pendingWriter`
 * names an in-flight agent rewrite so the panel can warn that it may be
 * superseded. See lib/documents/memory-envelope.ts.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  return NextResponse.json({
    data: buildMemoryEnvelope(projectId, getProjectMemoryDoc(projectId)),
  });
}

const putMemorySchema = z.object({
  // The manual editor REJECTS oversized input (unlike the distillation flow,
  // which truncates) so a hand-written doc is never silently cut.
  content: z
    .string()
    .max(
      PROJECT_MEMORY_MAX_CHARS,
      `Project memory must stay under ${PROJECT_MEMORY_MAX_TOKENS} tokens (about ${PROJECT_MEMORY_MAX_CHARS} characters)`
    ),
  /**
   * The memory the editor LOADED, for optimistic concurrency. A dream or a
   * distill can land between that load and the click on Save; a manual write
   * does not archive, so replacing blindly would lose the agent's text for
   * good. Compared on the trimmed document, like the agent writers compare.
   * Omitted = unconditional (API consumers that do not edit a loaded copy).
   */
  expectedPrevious: z.string().nullable().optional(),
});

/**
 * PUT /api/projects/[projectId]/memory
 *
 * Creates or replaces the memory document with the given markdown body.
 * An empty string is valid: it clears the memory (the prompt section is
 * omitted for empty content, so agents simply stop seeing it).
 *
 * 409 `MEMORY_CHANGED` when `expectedPrevious` no longer matches the stored
 * memory: the write goes through the same guarded primitive as the two agent
 * writers, so no path overwrites a document it did not read.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const validated = await validateBody(putMemorySchema, request);
  if (isValidationError(validated)) return validated;
  const { content, expectedPrevious } = validated.data;

  let saved;
  try {
    saved = saveProjectMemoryGuarded(
      projectId,
      content,
      expectedPrevious === undefined
        ? {}
        : {
            // The lib compares against the trimmed stored content, null when
            // empty — normalise the editor's verbatim copy the same way.
            expectedPrevious: expectedPrevious?.trim() || null,
          }
    );
  } catch (error) {
    if (isProjectMemoryChangedError(error)) {
      return NextResponse.json(
        {
          error:
            "The project memory changed since it was loaded. Reload it before saving.",
          code: "MEMORY_CHANGED",
        },
        { status: 409 }
      );
    }
    throw error;
  }

  // Record who wrote the document, then tell every open Spec & Memory view to
  // re-fetch (story 2: no more polling), and leave an activity entry: manual
  // writes enter the project feed the same way agent writes do.
  recordMemoryWriteProvenance(projectId, { source: "manual", sessionId: null });
  eventBus.emit({
    type: "memory:changed",
    projectId,
    data: { source: "manual" },
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({ data: buildMemoryEnvelope(projectId, saved.doc) });
}
