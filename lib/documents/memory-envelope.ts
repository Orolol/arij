/**
 * The memory envelope GET/PUT /memory and POST /memory/restore answer with —
 * one builder so the three cannot drift on its shape.
 *
 * Only what the memory panel reads. `exists` and `maxChars` used to ride along
 * with no reader (the panel derives the cap locally), and `archive.content` —
 * up to 40 KB — was re-sent on every refetch while the panel showed only the
 * snapshot's date. The text is now served on demand by GET /memory/restore,
 * when the user is about to put it back.
 */
import type { MemoryDocRecord } from "./memory";
import { getProjectMemoryArchiveDoc } from "./memory";
import {
  getMemoryWriteProvenance,
  type MemoryWriteProvenance,
} from "./memory-provenance";
import {
  getPendingMemoryWriter,
  type PendingMemoryWriter,
} from "@/lib/workflow/memory-writer-lock";

export interface MemoryEnvelope {
  /** Empty when no memory document exists yet ("absent" reads as "empty"). */
  content: string;
  updatedAt: string | null;
  /** Who wrote the document last. */
  provenance: MemoryWriteProvenance | null;
  /** The pre-dream snapshot the panel can restore from, by date only. */
  archive: { updatedAt: string | null } | null;
  /** The in-flight agent rewrite, if any — the panel goes read-only. */
  pendingWriter: PendingMemoryWriter | null;
}

export function buildMemoryEnvelope(
  projectId: string,
  doc: MemoryDocRecord | null
): MemoryEnvelope {
  const archive = getProjectMemoryArchiveDoc(projectId);
  return {
    content: doc?.markdownContent ?? "",
    updatedAt: doc?.updatedAt ?? null,
    provenance: getMemoryWriteProvenance(projectId),
    archive: archive ? { updatedAt: archive.updatedAt ?? null } : null,
    pendingWriter: getPendingMemoryWriter(projectId),
  };
}
