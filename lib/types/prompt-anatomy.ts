import type { PromptAnatomySegment } from "@/lib/tokens/estimator";

/**
 * One row of the prompt anatomy band: a named agent × role, sampled from
 * that pair's most recent session that stored a prompt breakdown.
 *
 * Kept in lib/ so app/api routes and components share one definition without
 * creating a reverse dependency from app/api into components/.
 */
export interface PromptAnatomyRow {
  /** `named_agents.id` when the session recorded one. */
  agentId: string | null;
  /** Display name, e.g. "Opus Builder". */
  agentName: string;
  /** BUILD | BUG FIX | REVIEW | MERGE FIX | CHAT & SPEC | <uppercased type>. */
  role: string;
  /** Token counts per drawn segment, already folded. Zero = draw nothing. */
  segments: Record<PromptAnatomySegment, number>;
  /** Best-effort labels appended inside a segment. Never fabricated. */
  annotations: Partial<Record<"system" | "ticket", string>>;
  /** Sum of the six segments — NOT the stored `estimatedPromptTokens`. */
  total: number;
  /** The sampled session's `createdAt`, for the row tooltip. */
  sampledAt: string | null;
  sessionId: string | null;
}
