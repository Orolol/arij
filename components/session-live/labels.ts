/**
 * Copy tables for the live-session screen.
 *
 * The old page kept these inline alongside a `STATUS_PILL` map that painted
 * each status its own colour. That map is gone: colour is stratum or project
 * identity, never state, so the status is now carried by the WORD inside a
 * `<Stamp>` and by motion (the breathing dot, the crawling progress bar).
 *
 * NO COPY IN THIS FILE. Every table below holds catalogue KEY REFERENCES,
 * resolved where they are drawn with the namespace-less translator —
 * `useTranslations()`, `t(AGENT_TYPE_LABEL_KEYS[type])` — per pattern 3 in
 * `lib/i18n/catalogue.ts`. These tables are evaluated at import time and read
 * by pure logic (`deriveTypeLabel`, `statusStamp`) that never renders text,
 * which is exactly why they cannot hold a `t()` call and must not hold a
 * string.
 */
import type { StampTone } from "@/components/piscine";
import type { TranslationKey } from "@/lib/i18n/catalogue";

/**
 * Human name per dispatch role — THE table. Read by the live header stamp, the
 * NEXT chain and the project sessions list (`app/projects/:id/sessions`).
 *
 * It used to exist twice with divergent words for the same type ("Ticket" on
 * the list, "Ticket Build" on the live header) and without `release_notes` on
 * the live side, where a release-notes session printed its raw type. One
 * vocabulary now; the fuller name wins.
 */
export const AGENT_TYPE_LABEL_KEYS: Record<string, TranslationKey> = {
  build: "SessionLive.agentType.build",
  ticket_build: "SessionLive.agentType.ticketBuild",
  team_build: "SessionLive.agentType.teamBuild",
  review_security: "SessionLive.agentType.reviewSecurity",
  review_code: "SessionLive.agentType.reviewCode",
  review_compliance: "SessionLive.agentType.reviewCompliance",
  review_feature: "SessionLive.agentType.reviewFeature",
  review_second_opinion: "SessionLive.agentType.reviewSecondOpinion",
  grading: "SessionLive.agentType.grading",
  merge: "SessionLive.agentType.merge",
  tech_check: "SessionLive.agentType.techCheck",
  release_notes: "SessionLive.agentType.releaseNotes",
  memory_distill: "SessionLive.agentType.memoryDistill",
  dreaming: "SessionLive.agentType.dreaming",
  forensic: "SessionLive.agentType.forensic",
  failure_digest: "SessionLive.agentType.failureDigest",
};

/**
 * The word per session status — THE table, shared by the live header stamp and
 * the project sessions list, which each used to carry their own keys in a
 * different namespace (`SessionLive.status.*` vs `ProjectSessions.status.*`).
 */
export const STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  running: "SessionLive.status.running",
  queued: "SessionLive.status.queued",
  completed: "SessionLive.status.completed",
  failed: "SessionLive.status.failed",
  cancelled: "SessionLive.status.cancelled",
};

/**
 * Delivery verdicts, copied from `components/shared/SessionOutcomeBadge.tsx`.
 *
 * The LABELS only — that component also carries per-outcome colour classes
 * (`text-agent`, `bg-priority-yellow/10`, `border-destructive/30`), which is
 * state-as-colour and has no place on this screen. The badge itself is left
 * alone: the sessions LIST page still renders it.
 */
export const OUTCOME_LABEL_KEYS: Record<string, TranslationKey> = {
  answered: "SessionLive.outcome.answered",
  asked_question: "SessionLive.outcome.askedQuestion",
  silent: "SessionLive.outcome.silent",
  error: "SessionLive.outcome.error",
  transition_refused: "SessionLive.outcome.transitionRefused",
};

/** What the header stamp says, per session status. */
export interface StatusStamp {
  tone: StampTone;
  /** Catalogue key of the word; null for a status the table does not name. */
  wordKey: TranslationKey | null;
  /** The raw status, uppercased — printed when there is no catalogue word. */
  fallbackWord: string;
  dot?: boolean;
}

const STAMP_TONE_BY_STATUS: Record<string, { tone: StampTone; dot?: boolean }> = {
  running: { tone: "live", dot: true },
  queued: { tone: "next" },
  completed: { tone: "land" },
  failed: { tone: "failed" },
  cancelled: { tone: "next" },
};

/**
 * The stamp for a status. An unknown status keeps its own word rather than
 * being silently folded into a neighbour's — the trace has to stay true, and
 * a raw status is data, not copy, so it is never given a catalogue key.
 */
export function statusStamp(status: string): StatusStamp {
  const tone = STAMP_TONE_BY_STATUS[status];
  const wordKey = STATUS_LABEL_KEYS[status] ?? null;
  if (tone) return { ...tone, wordKey, fallbackWord: status.toUpperCase() };
  return { tone: "next", wordKey, fallbackWord: status.toUpperCase() };
}

/**
 * The short mono label on the project identity chip: `"Arij"` → `"ARIJ"`.
 *
 * Diacritics are stripped through NFD rather than dropped, so `"Prêt-à-coder"`
 * becomes `"PRETAC"` and not `"PRT"`.
 */
export function projectShortLabel(name: string): string {
  const ascii = name
    .normalize("NFD")
    // U+0300–U+036F, the combining diacritical marks NFD just split off.
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  const first = ascii.split(/[^A-Z0-9]+/).find(Boolean) ?? "";
  return first.slice(0, 6);
}
