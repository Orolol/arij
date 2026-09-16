import { isStoredPathWithin as isStrictlyWithin } from "@/lib/storage/stored-path";
import fs from "node:fs";
import path from "node:path";
import { and, count, eq } from "drizzle-orm";
import { db, type ArijDatabase } from "@/lib/db";
import {
  agentSessions,
  sessionArtifacts,
  type SessionArtifact,
} from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { resolveSessionsRoot } from "./session-paths";

export const MAX_SESSION_ARTIFACT_BYTES = 5 * 1024 * 1024;
export const MAX_SESSION_ARTIFACTS = 10;
export const MAX_ARTIFACT_CAPTION_LENGTH = 2000;

export type ArtifactImageType = "png" | "jpeg" | "webp";

export type SessionArtifactErrorCode =
  | "INVALID_ARTIFACT_INPUT"
  | "SESSION_NOT_FOUND"
  | "WORKTREE_UNAVAILABLE"
  | "PATH_OUTSIDE_WORKTREE"
  | "FILE_NOT_FOUND"
  | "INVALID_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "ARTIFACT_LIMIT_REACHED"
  | "ARTIFACT_STORAGE_FAILED";

/** A safe, agent-readable failure that the MCP HTTP route can expose. */
export class SessionArtifactError extends Error {
  constructor(
    readonly code: SessionArtifactErrorCode,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "SessionArtifactError";
  }
}

export interface AttachSessionArtifactInput {
  sessionId: string;
  projectId: string;
  sourcePath: string;
  caption: string;
}

export interface AttachSessionArtifactOptions {
  database?: ArijDatabase;
  /** Parent of <session-id>/artifacts; injectable for isolated tests. */
  sessionsRoot?: string;
}

const EXTENSION_TYPES: Readonly<Record<string, ArtifactImageType>> = {
  ".png": "png",
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".webp": "webp",
};



/** Sniff only the image signatures Arij accepts as visual session proofs. */
export function sniffArtifactImageType(bytes: Buffer): ArtifactImageType | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "png";
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpeg";
  }

  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

function readAndValidateSource(
  worktreePath: string,
  sourcePath: string
): { bytes: Buffer; extension: string } {
  const configuredWorktree = path.resolve(worktreePath);
  const candidate = path.isAbsolute(sourcePath)
    ? path.resolve(sourcePath)
    : path.resolve(configuredWorktree, sourcePath);

  // Reject obvious traversal before touching the target. The realpath check
  // below separately blocks an in-worktree symlink that points outside.
  if (!isStrictlyWithin(configuredWorktree, candidate)) {
    throw new SessionArtifactError(
      "PATH_OUTSIDE_WORKTREE",
      "Artifact path must resolve to a file inside this session's worktree.",
      400
    );
  }

  let realWorktree: string;
  try {
    realWorktree = fs.realpathSync(configuredWorktree);
  } catch {
    throw new SessionArtifactError(
      "WORKTREE_UNAVAILABLE",
      "This session's worktree is no longer available; attach artifacts before the session ends.",
      409
    );
  }

  let realSource: string;
  try {
    realSource = fs.realpathSync(candidate);
  } catch {
    throw new SessionArtifactError(
      "FILE_NOT_FOUND",
      "Artifact file was not found in this session's worktree.",
      404
    );
  }

  if (!isStrictlyWithin(realWorktree, realSource)) {
    throw new SessionArtifactError(
      "PATH_OUTSIDE_WORKTREE",
      "Artifact path must resolve to a file inside this session's worktree; symlinks outside it are not allowed.",
      400
    );
  }

  const extension = path.extname(candidate).toLowerCase();
  const expectedType = EXTENSION_TYPES[extension];
  if (!expectedType) {
    throw new SessionArtifactError(
      "INVALID_FILE_TYPE",
      "Artifact must use a .png, .jpg, .jpeg, or .webp extension.",
      400
    );
  }

  let descriptor: number;
  try {
    descriptor = fs.openSync(realSource, "r");
  } catch {
    throw new SessionArtifactError(
      "FILE_NOT_FOUND",
      "Artifact file could not be opened from this session's worktree.",
      404
    );
  }

  let bytes: Buffer;
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile()) {
      throw new SessionArtifactError(
        "INVALID_ARTIFACT_INPUT",
        "Artifact path must point to a regular file.",
        400
      );
    }
    if (stats.size > MAX_SESSION_ARTIFACT_BYTES) {
      throw new SessionArtifactError(
        "FILE_TOO_LARGE",
        "Artifact exceeds the 5 MiB size limit.",
        413
      );
    }
    bytes = fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }

  // Recheck the bytes actually read in case the source grew after fstat.
  if (bytes.length > MAX_SESSION_ARTIFACT_BYTES) {
    throw new SessionArtifactError(
      "FILE_TOO_LARGE",
      "Artifact exceeds the 5 MiB size limit.",
      413
    );
  }

  const actualType = sniffArtifactImageType(bytes);
  if (!actualType) {
    throw new SessionArtifactError(
      "INVALID_FILE_TYPE",
      "Artifact content is not a PNG, JPEG, or WebP image.",
      400
    );
  }
  if (actualType !== expectedType) {
    throw new SessionArtifactError(
      "INVALID_FILE_TYPE",
      `Artifact extension ${extension} does not match its ${actualType.toUpperCase()} content.`,
      400
    );
  }

  return { bytes, extension };
}

/**
 * Validate and synchronously copy one artifact out of its owning worktree.
 * The database row is written only after the durable copy exists.
 */
export function attachSessionArtifact(
  input: AttachSessionArtifactInput,
  options: AttachSessionArtifactOptions = {}
): SessionArtifact {
  const database = options.database ?? db;
  const sessionsRoot = resolveSessionsRoot(options.sessionsRoot);
  const sourcePath = input.sourcePath.trim();
  const caption = input.caption.trim();

  if (!sourcePath) {
    throw new SessionArtifactError(
      "INVALID_ARTIFACT_INPUT",
      "Artifact path cannot be empty.",
      400
    );
  }
  if (!caption || caption.length > MAX_ARTIFACT_CAPTION_LENGTH) {
    throw new SessionArtifactError(
      "INVALID_ARTIFACT_INPUT",
      `Artifact caption must contain 1 to ${MAX_ARTIFACT_CAPTION_LENGTH} characters.`,
      400
    );
  }

  const session = database
    .select({
      id: agentSessions.id,
      epicId: agentSessions.epicId,
      worktreePath: agentSessions.worktreePath,
    })
    .from(agentSessions)
    .where(
      and(
        eq(agentSessions.id, input.sessionId),
        eq(agentSessions.projectId, input.projectId)
      )
    )
    .get();

  if (!session) {
    throw new SessionArtifactError(
      "SESSION_NOT_FOUND",
      "Agent session was not found in this project.",
      404
    );
  }
  if (!session.epicId) {
    throw new SessionArtifactError(
      "INVALID_ARTIFACT_INPUT",
      "This session is not attached to a ticket, so it cannot attach review artifacts.",
      400
    );
  }
  if (!session.worktreePath) {
    throw new SessionArtifactError(
      "WORKTREE_UNAVAILABLE",
      "This session has no worktree from which an artifact can be attached.",
      409
    );
  }

  const existingCount =
    database
      .select({ value: count() })
      .from(sessionArtifacts)
      .where(eq(sessionArtifacts.agentSessionId, session.id))
      .get()?.value ?? 0;
  if (existingCount >= MAX_SESSION_ARTIFACTS) {
    throw new SessionArtifactError(
      "ARTIFACT_LIMIT_REACHED",
      `This session already has the maximum of ${MAX_SESSION_ARTIFACTS} artifacts.`,
      409
    );
  }

  const { bytes, extension } = readAndValidateSource(
    session.worktreePath,
    sourcePath
  );

  // Session ids are generated server-side, but enforce the basename invariant
  // before using one as a directory component as defense in depth.
  if (path.basename(session.id) !== session.id) {
    throw new SessionArtifactError(
      "ARTIFACT_STORAGE_FAILED",
      "Arij could not allocate safe storage for this artifact.",
      500
    );
  }

  const id = createId();
  const filename = `${id}${extension}`;
  const artifactDirectory = path.join(sessionsRoot, session.id, "artifacts");
  const destination = path.join(artifactDirectory, filename);
  const now = new Date().toISOString();
  const artifact: SessionArtifact = {
    id,
    agentSessionId: session.id,
    epicId: session.epicId,
    filename,
    caption,
    createdAt: now,
  };

  let destinationDescriptor: number | null = null;
  try {
    fs.mkdirSync(artifactDirectory, { recursive: true, mode: 0o700 });
    destinationDescriptor = fs.openSync(destination, "wx", 0o600);
    fs.writeFileSync(destinationDescriptor, bytes);
    fs.closeSync(destinationDescriptor);
    destinationDescriptor = null;
  } catch {
    if (destinationDescriptor !== null) {
      try {
        fs.closeSync(destinationDescriptor);
        fs.unlinkSync(destination);
      } catch {
        // Best effort cleanup of a partially written new file.
      }
    }
    throw new SessionArtifactError(
      "ARTIFACT_STORAGE_FAILED",
      "Arij could not copy the artifact into durable session storage.",
      500
    );
  }

  try {
    database.insert(sessionArtifacts).values(artifact).run();
  } catch {
    try {
      fs.unlinkSync(destination);
    } catch {
      // Best effort: preserve the original database error path below.
    }
    throw new SessionArtifactError(
      "ARTIFACT_STORAGE_FAILED",
      "Arij copied the artifact but could not register it; the copy was rolled back.",
      500
    );
  }

  return artifact;
}

export interface RemoveSessionArtifactsOptions {
  /** Parent of <session-id>/artifacts; injectable for isolated tests. */
  sessionsRoot?: string;
}

/**
 * Unlink the durable visual-proof copies of sessions whose rows are gone.
 *
 * The copies are deliberately detached from the worktree, so nothing else
 * reclaims them: the FK cascade removes `session_artifacts` rows but cannot
 * touch the filesystem, and the retention routine (`lib/routines/retention.ts`)
 * only prunes session chunks. The permanent delete paths are therefore the
 * one place these bytes can go — call this AFTER their transaction commits,
 * so a rolled-back delete never loses a proof whose row survived.
 *
 * Only `<root>/<id>/artifacts` is removed: the session directory also holds
 * other output (logs) that is not this function's to decide about. Ids come
 * from the database, but they become path segments here, so anything that is
 * not one plain segment is skipped rather than trusted. Best effort: a failure
 * to unlink never undoes the delete that already happened. Returns how many
 * artifact directories were actually removed.
 */
export function removeSessionArtifactDirectories(
  sessionIds: readonly string[],
  options: RemoveSessionArtifactsOptions = {}
): number {
  const sessionsRoot = resolveSessionsRoot(options.sessionsRoot);
  let removed = 0;

  for (const sessionId of sessionIds) {
    if (
      typeof sessionId !== "string" ||
      sessionId.length === 0 ||
      sessionId === "." ||
      sessionId === ".." ||
      sessionId.includes("\0") ||
      path.basename(sessionId) !== sessionId
    ) {
      continue;
    }

    const directory = path.join(sessionsRoot, sessionId, "artifacts");
    if (!isStrictlyWithin(sessionsRoot, directory)) continue;

    try {
      if (!fs.existsSync(directory)) continue;
      fs.rmSync(directory, { recursive: true, force: true });
      removed += 1;
    } catch {
      // Best effort: the rows are already gone either way.
    }
  }

  return removed;
}
