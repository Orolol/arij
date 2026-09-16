/**
 * Wire contract for GET /api/projects/:projectId/sessions/:sessionId/files.
 *
 * Kept in lib/ so API routes and components share one definition without
 * creating a reverse dependency from app/api into components/.
 */

/** The epic this session was dispatched against, as the header renders it. */
export interface SessionFilesTicket {
  id: string;
  readableId: string | null;
  title: string;
}

/** Just enough of the project row for the identity chip. */
export interface SessionFilesProject {
  id: string;
  name: string;
}

/** Why the diff could not be produced. Never a thrown 500 — see the route. */
export type SessionDiffUnavailableReason =
  | "no-worktree"
  | "worktree-missing"
  | "not-a-repo"
  | "git-failed";

/**
 * One changed file. `added`/`removed` are `null` for a binary file, where
 * `git diff --numstat` writes `-` rather than a count — `DiffDelta` then
 * renders nothing rather than a false `+0 −0`.
 */
export interface SessionDiffFile {
  path: string;
  added: number | null;
  removed: number | null;
  /** Present in the staged/unstaged numstat: the agent is still writing it. */
  inProgress: boolean;
}

export interface SessionDiffTotals {
  files: number;
  added: number;
  removed: number;
}

export interface SessionDiff {
  available: boolean;
  reason?: SessionDiffUnavailableReason;
  branchName: string | null;
  baseBranch: string | null;
  mergeBase: string | null;
  behind: number | null;
  ahead: number | null;
  files: SessionDiffFile[];
  /** Computed over ALL rows, even when `files` was capped. */
  totals: SessionDiffTotals | null;
  /** `files` was cut at the row cap; `totals` still covers everything. */
  truncated: boolean;
}

export interface SessionFilesResponse {
  sessionId: string;
  ticket: SessionFilesTicket | null;
  project: SessionFilesProject | null;
  diff: SessionDiff;
}
