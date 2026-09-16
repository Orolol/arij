import type { ProjectFrictionSummary } from "@/lib/frictions/prompt";
/** Plain input projections shared by prompt composition and section helpers. */
import type { PromptSectionCollector } from "../prompt-sections";

export interface PromptProject {
  name: string;
  description?: string | null;
  spec?: string | null;
  /**
   * Project id — present when callers pass a full Drizzle project row (every
   * dispatch route does). Enables the builders to resolve the learned
   * project memory without each route wiring it explicitly.
   */
  id?: string | null;
  /**
   * Learned project memory content. `undefined` means "not resolved yet"
   * (builders look it up from the memory document via `id`); `null`/empty
   * means "resolved, none" and suppresses the section.
   */
  memory?: string | null;
}

export interface PromptDocument {
  name: string;
  contentMd: string;
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PromptEpic {
  title: string;
  description?: string | null;
  type?: string | null;
  /**
   * Owning project id — present when callers pass a full Drizzle epic row
   * (every dispatch route does). Required to read `images`, whose stored
   * paths are namespaced per project.
   */
  projectId?: string | null;
  /**
   * `epics.images` verbatim — a JSON array of upload paths written by the bug
   * creation modal, or null. Left as `unknown` because the column is
   * free-form text: the normaliser, not the type, decides what is usable.
   */
  images?: unknown;
}

export interface PromptUserStory {
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
}

export interface PromptCiFailure {
  name: string;
  logTail: string | null;
  /** Distinguishes a budget-dropped log from one GitHub never exposed. */
  logTailReason?: "unavailable" | "budget";
}

/** Story projection used by the acceptance-criteria grader. */
export interface PromptGradingStory extends PromptUserStory {
  /** Stable database id required by submit_grading's scoped payload. */
  id: string;
}

/** Minimal projection shared by deterministic-verification prompt sections. */
export interface PromptVerificationCommand {
  name: string;
  command: string;
  exitCode: number | null;
  durationMs: number;
  tail: string;
}

export interface BuildPromptOptions {
  /** Effective value of the global visual_proof_enabled setting. */
  visualProofEnabled?: boolean;
  /** Optional exact-section sink used by dispatch token estimation. */
  sectionCollector?: PromptSectionCollector;
  /** Active project frictions to avoid repeated obstacles. */
  activeFrictions?: ProjectFrictionSummary[];
}

export interface PromptEpicStatus {
  id: string;
  title: string;
  status?: string | null;
}

export interface PromptUserStoryStatus {
  epicId: string;
  title: string;
  status?: string | null;
}

export interface PromptReleaseSummary {
  version: string;
  title?: string | null;
  changelog?: string | null;
}

/**
 * Builds the prompt for implementing an epic with Claude Code in code mode.
 * The prompt includes the full project context, the target epic, and its
 * user stories with acceptance criteria.
 */
/**
 * Unlike the solo builders, which take a Drizzle epic row whole, a team epic is
 * a hand-built projection — so it has to name every field it forwards.
 * `projectId`/`images` are picked from `PromptEpic` rather than redeclared so a
 * batch build cannot silently drop a bug's screenshots the way it once did.
 */
export interface TeamEpic extends Pick<
  PromptEpic,
  "projectId" | "images" | "type"
> {
  title: string;
  description?: string | null;
  worktreePath: string;
  userStories: PromptUserStory[];
}

export interface PromptComment {
  author: "user" | "agent";
  content: string;
  createdAt: string;
  /**
   * `agent_type` of the session that posted the comment, when it came from an
   * agent — the only thing that tells a review document apart from a build
   * report. Loaded by lib/tickets/prompt-comments.ts; absent means "not a
   * review", which is the safe default (the comment is kept).
   */
  agentType?: string | null;
}

export type ReviewType =
  "security" | "code_review" | "compliance" | "feature_review";

/**
 * Context of the just-finished session a memory distillation runs after.
 * All fields are optional — the prompt renders only what is known.
 */
export interface MemoryDistillSessionContext {
  /** Title of the ticket (epic or user story) the session worked on. */
  ticketTitle?: string | null;
  /** Agent type of the source session (e.g. "build", "ticket_build"). */
  agentType?: string | null;
  /** Delivery verdict of the source session (answered/silent/...). */
  outcome?: string | null;
  /**
   * Last textual output of the source session (result envelope or streamed
   * chunks — see lib/workflow/memory-distill.ts for how it is resolved).
   */
  resultSummary?: string | null;
}

/** The cross-session evidence a dream reasons over (lib/workflow/dreaming.ts). */
export interface DreamingDigestContext {
  /** Assembled per-session digest, already size-budgeted. */
  digest: string;
  /** Sessions the digest carries. */
  sessionCount: number;
  /** Start of the collection window (ISO). */
  sinceIso: string;
  /** Sessions cut to fit the digest budget. */
  truncatedCount?: number;
  /** Sessions the budget could not fit at all. */
  droppedCount?: number;
}

/**
 * Board snapshot the auto rewrite grounds the spec in: every epic/story
 * status plus the release history, so the agent can tell what actually
 * shipped from what is still planned.
 */
export interface SpecRewriteBoardState {
  epics: Array<{ id: string; title: string; status: string }>;
  userStories: Array<{ epicId: string; title: string; status: string }>;
  releases: Array<{
    version: string;
    title: string | null;
    changelog: string | null;
  }>;
}

/** The release that triggered the rewrite. */
export interface SpecRewriteReleaseContext {
  version: string;
  title: string | null;
  changelog: string | null;
}
