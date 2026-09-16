/**
 * The client-side view model of the live-session screen.
 *
 * `SessionDetail` mirrors, field for field, what
 * `GET /api/projects/:projectId/sessions/:sessionId` returns — every
 * `agent_sessions` column EXCEPT `prompt`, plus the derived extras the route
 * computes (`status`, `cliSessionId`, `logs`, `chunkStreams`, `arijActions`
 * and the three explicit failure flags). The prompt is served only on
 * `?include=prompt` because it reaches 1.8 MB per row on the live database,
 * so it is optional here and arrives through its own lazy request.
 *
 * `SessionFilesResponse` mirrors the new read-only sibling route
 * `GET /api/projects/:projectId/sessions/:sessionId/files`.
 */
import type { ArijActionItem } from "@/components/shared/ArijActionsList";
import type { SessionStreamSeed } from "./useSessionStreamPager";
import type { AgentSessionStreamType } from "@/lib/agent-sessions/chunks";

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
  logs?: {
    success?: boolean;
    result?: string;
    error?: string;
    duration?: number;
  } | null;
  /** Bounded first page of each stream; the rest is paged in on demand. */
  chunkStreams?: Partial<Record<AgentSessionStreamType, SessionStreamSeed>> | null;
  /** The chunk read failed — distinct from a session that wrote nothing. */
  chunkStreamsUnavailable?: boolean;
  /** `logs.json` was too large to serve whole, or its result was capped. */
  logsTruncated?: boolean;
  /** `logs.json` exists but could not be read or parsed. */
  logsUnavailable?: boolean;
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
