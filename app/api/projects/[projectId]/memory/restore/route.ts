import { NextRequest, NextResponse } from "next/server";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import {
  getProjectMemoryArchiveDoc,
  saveProjectMemory,
} from "@/lib/documents/memory";
import { buildMemoryEnvelope } from "@/lib/documents/memory-envelope";
import { recordMemoryWriteProvenance } from "@/lib/documents/memory-provenance";
import { eventBus } from "@/lib/events/bus";
import { clearDreamCutoff } from "@/lib/workflow/dreaming-settings";

type Params = { params: Promise<{ projectId: string }> };

const NO_SNAPSHOT = "No memory snapshot to restore yet";

/**
 * GET /api/projects/[projectId]/memory/restore
 *
 * The snapshot text a restore would put back, for the panel's confirmation
 * preview. Served here, on demand, rather than inside the memory envelope:
 * the envelope is refetched on every memory/session event, and the snapshot
 * (up to 40 KB) is only worth sending when the user is about to restore it.
 *
 * 404 when there is no snapshot.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const archive = getProjectMemoryArchiveDoc(projectId);
  if (!archive) {
    return NextResponse.json({ error: NO_SNAPSHOT }, { status: 404 });
  }
  return NextResponse.json({
    data: {
      content: archive.markdownContent ?? "",
      updatedAt: archive.updatedAt ?? null,
    },
  });
}

/**
 * POST /api/projects/[projectId]/memory/restore
 *
 * Story 5 of the "gérer la section mémoire" epic: puts back the pre-dream
 * snapshot (the MEMORY_ARCHIVE document that `replaceProjectMemoryWithSnapshot`
 * takes atomically before a dream rewrites the memory) in one click.
 *
 * It is a MANUAL write — not a dream undo path that agents may touch:
 * - the restore is UNCONDITIONAL on purpose. If a Dreaming or distillation
 *   rewrite is in flight when the user clicks restore, that write will later
 *   hit the optimistic guard (the memory content no longer matches what it
 *   reasoned from), drop its own output and end `failed` with the reason on
 *   its session row. The user just clicked the button: they win.
 * - restoring writes provenance "manual" and emits the SAME `memory:changed`
 *   event as every other write, so open panels re-fetch through one channel
 *   and the activity feed shows the restore as a first-class event.
 * - it forgets the dream cutoff. The cutoff means "the evidence up to here is
 *   inside the stored memory"; putting back the text from BEFORE the dream
 *   makes that false for every session the dream digested. Left in place,
 *   those sessions would be marked learned with nothing left of them, and no
 *   dream would ever read them again. Re-reading a few older sessions is the
 *   harmless direction.
 *
 * 404s when there is no snapshot yet (nothing to restore).
 */
export async function POST(_request: NextRequest, { params }: Params) {
  const { projectId } = await params;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;

  const archive = getProjectMemoryArchiveDoc(projectId);
  if (!archive) {
    return NextResponse.json({ error: NO_SNAPSHOT }, { status: 404 });
  }

  const { doc } = saveProjectMemory(
    projectId,
    archive.markdownContent ?? ""
  );
  clearDreamCutoff(projectId);

  // Same bookkeeping as every manual memory write: provenance, one SSE event,
  // one activity entry (flagged "restored" so the feed says it was a restore).
  recordMemoryWriteProvenance(projectId, { source: "manual", sessionId: null });
  eventBus.emit({
    type: "memory:changed",
    projectId,
    data: { source: "manual", restored: true },
    timestamp: new Date().toISOString(),
  });

  return NextResponse.json({ data: buildMemoryEnvelope(projectId, doc) });
}
