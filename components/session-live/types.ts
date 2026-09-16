/**
 * The client-side view model of the live-session screen.
 *
 * `SessionDetail` mirrors, field for field, what
 * `GET /api/projects/:projectId/sessions/:sessionId` returns — every
 * `agent_sessions` column EXCEPT `prompt`, plus the derived extras the route
 * computes (`status`, `cliSessionId`, `chunkStreams`, `arijActions` and the
 * explicit failure flags). The prompt is served only on `?include=prompt`
 * because it reaches 1.8 MB per row on the live database, so it is optional
 * here and arrives through its own lazy request. `logs.json` is likewise only
 * on `?include=logs` (see `fetchSessionLogs`) and is not part of this model:
 * the polled payload never carries it.
 *
 * `SessionFilesResponse` mirrors the new read-only sibling route
 * `GET /api/projects/:projectId/sessions/:sessionId/files`.
 */
import type { ArijActionItem } from "@/components/shared/ArijActionsList";
import type { SessionStreamSeed } from "./useSessionStreamPager";
import type { SessionStreamTailSeed } from "@/lib/agent-sessions/session-detail";

export interface SessionDetail {
  id: string;
  status: string;
  mode: string;
  provider?: string;
  prompt?: string;
  error?: string;
  branchName?: string;
  worktreePath?: string;
  epicId?: string;
  startedAt?: string;
  endedAt?: string;
  completedAt?: string;
  createdAt: string;
  lastNonEmptyText?: string | null;
  cliSessionId?: string | null;
  agentType?: string | null;
  outcome?: string | null;
  namedAgentName?: string | null;
  /**
   * The COMPOSITE that dispatched this run, when one did. `namedAgentName`
   * stays the member that actually ran; without both, two runs resolved from
   * different fallback lists are indistinguishable in the audit trail.
   */
  compositeAgentName?: string | null;
  model?: string | null;
  /** JSON object of the per-CLI options in effect for this run. */
  cliOptions?: string | null;
  cliCommand?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalCostUsd?: number | null;
  estimatedPromptTokens?: number | null;
  estimatedPromptBreakdown?: string | null;
  arijActions?: ArijActionItem[] | null;
  /**
   * Where the run's `logs.json` was written, when it was. A pointer only —
   * the document itself is read on demand with `?include=logs`.
   */
  logsPath?: string | null;
  /**
   * Bounded preview of each stream; the rest is paged in on demand. `raw` is
   * its END (a tail seed, walked back with `before`); `output` and
   * `response` are their head.
   */
  chunkStreams?: {
    raw?: SessionStreamTailSeed;
    output?: SessionStreamSeed;
    response?: SessionStreamSeed;
  } | null;
  /** The chunk read failed — distinct from a session that wrote nothing. */
  chunkStreamsUnavailable?: boolean;
}

export type {
  SessionFilesTicket,
  SessionFilesProject,
  SessionDiffUnavailableReason,
  SessionDiffFile,
  SessionDiffTotals,
  SessionDiff,
  SessionFilesResponse,
} from "@/lib/types/session-files";
