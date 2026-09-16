/**
 * Client-safe constants for "Dreaming" — the cross-session distillation pass.
 *
 * Where `memory_distill` (lib/workflow/memory-distill.ts) looks at ONE session
 * and merges what it taught into the project memory, a dream looks at the last
 * N terminal sessions of MANY tickets — successes and failures alike — and
 * rewrites the memory around what only the batch shows: recurring agent
 * mistakes, codebase traps, strategies that actually work.
 *
 * Kept free of any database / server import so client components (settings
 * page, Docs tab) can import the setting keys, the agent type and the caps
 * without pulling server modules into the bundle — same pattern as
 * lib/workflow/spec-rewrite-constants.ts and lib/pipeline/constants.ts.
 */

import { parseBooleanSetting } from "@/lib/documents/memory-constants";

/* ------------------------------------------------------------------ */
/* Agent identity                                                      */
/* ------------------------------------------------------------------ */

/**
 * Dedicated agent type for the dream session. Its own type (rather than
 * reusing 'memory_distill') is what makes the concurrency guard, the session
 * filters and the Agent Config overrides able to tell the two writers of the
 * memory document apart.
 */
export const DREAMING_AGENT_TYPE = "dreaming";

/**
 * Agent types that WRITE the project memory document. Neither may ever be a
 * source for a memory pass — no distilling a distill, no dreaming about a
 * dream — and neither belongs in a dream digest (their output is the memory,
 * not evidence about the codebase).
 */
export const MEMORY_WRITER_AGENT_TYPES: readonly string[] = [
  "memory_distill",
  DREAMING_AGENT_TYPE,
];

/**
 * Agent types that must NOT get the Arij MCP tool channel.
 *
 * Both memory writers are strict document-rewrite sessions: their ENTIRE
 * response is written verbatim into the memory document, and neither carries
 * an epicId (they are project-level passes). The MCP injection appends its
 * "## Arij tools" section to the END of the prompt — after the output contract
 * that says "respond with the document body and nothing else" — so the last
 * thing such a session reads becomes "post comments, move the ticket", about a
 * ticket it does not have. Skipping the channel entirely keeps the output
 * contract final and the tool surface honest.
 *
 * Consumed by lib/claude/process-manager.ts, the single wiring point for agent
 * sessions.
 */
export const MCP_EXEMPT_AGENT_TYPES: readonly string[] = [
  ...MEMORY_WRITER_AGENT_TYPES,
  // Project-level QA report writer: it has no ticket scope, and its entire
  // response is persisted as the report body. Appending ticket-tool guidance
  // would be both unusable and after its output contract.
  "failure_digest",
  "forensic",
  "spec_generation",
];

export function isMcpExemptAgentType(
  agentType: string | null | undefined
): boolean {
  return agentType != null && MCP_EXEMPT_AGENT_TYPES.includes(agentType);
}

/* ------------------------------------------------------------------ */
/* Settings keys                                                       */
/* ------------------------------------------------------------------ */

/**
 * Global settings key: run a dream when a night run finishes. DEFAULT OFF —
 * an absent key means the night run ends exactly as it does today.
 *
 * Global ONLY, on purpose. A `dreaming_after_night_run:<projectId>` override
 * was once resolved ahead of it, allowed through PATCH /api/settings and swept
 * on project deletion — and written by nothing: no field, no dialog, no route.
 * A key only a hand-made request can set is not a setting, so the scoped form
 * was retired rather than given a screen.
 */
export const DREAMING_AFTER_NIGHT_RUN_SETTING_KEY = "dreaming_after_night_run";

/**
 * Parses the raw settings value into a tri-state (null = "not configured", so
 * the caller applies the OFF default). The same parser as the auto-distill
 * switch: both memory-writer toggles must agree on what "on" looks like.
 */
export const parseDreamingAfterNightRunSetting = parseBooleanSetting;

/**
 * Why a delivered dream or distill did NOT replace the memory document.
 *
 * Carried on the `memory:discarded` event and mapped to copy by the memory
 * panel (a code, never a sentence: the server does not know the UI locale).
 * The session row carries the English sentence in its `error` column.
 */
export const MEMORY_DISCARD_REASONS = [
  // The session answered with nothing usable once sanitised.
  "no_output",
  // The document would not have carried the four imposed sections once capped.
  "invalid_structure",
  // A human edit landed while the writer ran; the edit wins.
  "memory_changed",
  // The guarded write itself threw (constraint, disk).
  "save_failed",
] as const;

export type MemoryDiscardReason = (typeof MEMORY_DISCARD_REASONS)[number];

export function isMemoryDiscardReason(
  value: unknown
): value is MemoryDiscardReason {
  return (
    typeof value === "string" &&
    (MEMORY_DISCARD_REASONS as readonly string[]).includes(value)
  );
}

/**
 * Why a dream dispatch was refused without spending a session.
 *
 * Returned next to the human-readable `reason` (journal, API consumers) so the
 * memory panel can pick a translated sentence by code instead of splicing an
 * English phrase into a localised one.
 */
export type DreamGuardCode = "eligible" | "writer_pending" | "no_new_sessions";

/**
 * Per-project settings key holding the moment the last SUCCESSFUL dream
 * collected its digest — the lower bound of the next dream's window.
 *
 * Why a persisted cutoff rather than "when the last dream session finished":
 *   - a dream collects at T0 and finishes minutes later at T1. A session that
 *     reached a terminal state in between was never in that digest, so a
 *     window opening at T1 would skip it FOREVER. Opening at T0 re-reads at
 *     worst a few sessions, which is the harmless direction;
 *   - it is written only after the memory document was actually replaced, so a
 *     dream that delivered text but failed to persist it does not advance the
 *     window past evidence nothing ever learned from;
 *   - it is CLEARED when the pre-dream snapshot is restored: the memory then
 *     no longer holds what the undone dream learned, so its sessions must be
 *     readable again (see `clearDreamCutoff`).
 */
export const DREAMING_LAST_CUTOFF_SETTING_KEY = "dreaming_last_cutoff";

export function dreamingLastCutoffSettingKey(projectId: string): string {
  return `${DREAMING_LAST_CUTOFF_SETTING_KEY}:${projectId}`;
}

/**
 * The four sections a dreamed memory MUST be organised into, in this order.
 *
 * Imposed rather than suggested: the value of a dream is that every project's
 * memory answers the same four questions, so an agent reading it knows where
 * to look. Lives here rather than in the prompt builder because it is BOTH
 * halves of one contract — the prompt asks for these headings and the
 * workflow refuses to store a document that does not have them (see
 * `validateDreamedMemoryStructure`).
 */
export const DREAMING_MEMORY_SECTIONS: readonly string[] = [
  "Codebase pitfalls",
  "Recurring agent mistakes",
  "Strategies that work",
  "Build instructions",
];

/* ------------------------------------------------------------------ */
/* Collection window                                                   */
/* ------------------------------------------------------------------ */

/**
 * Terminal sessions a single dream may look at. The window starts at the last
 * dream's collection cutoff (so consecutive dreams never re-read the same
 * evidence) but is capped on BOTH axes — count and age — because a first dream
 * on a busy project would otherwise try to swallow the entire session history.
 *
 * A session belongs to the window by the moment it REACHED a terminal state,
 * not by when it started: a long build running across a dream became evidence
 * only when it ended, and that is when a dream may read it.
 */
export const DREAM_MAX_SESSIONS = 30;

/** Hard floor on the window: nothing older than this feeds a dream. */
export const DREAM_WINDOW_DAYS = 14;

/**
 * Session types worth dreaming about: the code-writing flavors and the
 * reviewers. Pipeline "fix" stages are dispatched as build/ticket_build
 * sessions (lib/pipeline/stages.ts picks the agent type from the SCOPE, not
 * from the stage), so they are covered by the build entries and need no type
 * of their own. Merges, QA, release notes, chat and the two memory writers are
 * deliberately absent — they teach nothing about how the codebase resists.
 */
export const DREAM_SOURCE_AGENT_TYPES: readonly string[] = [
  "build",
  "ticket_build",
  "team_build",
  "review_code",
  "review_security",
  "review_compliance",
  "review_feature",
];

/* ------------------------------------------------------------------ */
/* Digest size budget                                                  */
/* ------------------------------------------------------------------ */

/**
 * HARD ceiling on the assembled digest (~60 KB of ASCII markdown). The point
 * of a dream is a compact cross-session view, not a log dump: raw chunk
 * streams are never embedded, and what is embedded is cut to fit by
 * `allocateFairBudgets` so no single verbose session can starve the others.
 */
export const DREAM_DIGEST_MAX_CHARS = 60_000;

/** Per-session cap on the tail of the final response, before fair truncation. */
export const DREAM_FINAL_TEXT_MAX_CHARS = 1200;

/**
 * How much of a session's final-response STREAM the collector reads before the
 * render cap above trims it further.
 *
 * Wider than the render cap on purpose: the review verdict is scraped from the
 * whole resolved text, and a report can carry a closing paragraph after its
 * `**Overall Verdict: …**` line. Reading a comfortable tail keeps the scrape
 * reliable at negligible cost, since only the last DREAM_FINAL_TEXT_MAX_CHARS
 * ever reach the prompt.
 */
export const DREAM_FINAL_TEXT_SOURCE_MAX_CHARS = 4000;

/** Per-session cap on an attached forensic diagnostic. */
export const DREAM_FORENSIC_MAX_CHARS = 900;

/** Per-session cap on one `[critical]`/`[major]` finding body. */
export const DREAM_FINDING_MAX_CHARS = 240;

/** Per-session cap on how many findings are listed. */
export const DREAM_MAX_FINDINGS_PER_SESSION = 6;

/** Per-session cap on the stored error / transition-refusal reason. */
export const DREAM_ERROR_MAX_CHARS = 400;

/**
 * Slack after a session ends during which a forensic diagnostic filed on its
 * ticket is attributed to it. The pipeline dispatches the forensic agent
 * immediately after the doomed stage settles, so a short window is enough and
 * keeps an unrelated later diagnostic out of the digest.
 */
export const DREAM_FORENSIC_ATTACH_SLACK_MS = 30 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* Trace strings                                                       */
/* ------------------------------------------------------------------ */

/** Notification title prefix for a memory rewritten by a dream. */
export const MEMORY_DREAMED_TITLE = "Project memory updated by Dreaming";

/** Console prefix for the dream workflow's journal lines (incl. no-ops). */
export const DREAMING_LOG_PREFIX = "[dreaming]";
