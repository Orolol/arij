/**
 * The contract of `GET /api/projects/:projectId/sessions/active` — the monitor's
 * poll.
 *
 * ONE DEFINITION. The route used to declare this interface, `hooks/useAgentPolling.ts`
 * declared a diverging copy of it (five fields optional that the route always
 * sends) and `hooks/useAgentDispatch.ts` typed the same payload as the narrower,
 * partly fictional `AgentSession`. Imported here by all three, plus
 * `hooks/useTicketOverlayData.ts`, which used to cast the payload three times to
 * read fields its type did not carry.
 *
 * Dependency-free on purpose: the server route and the client hooks both import
 * it, so it must not reach `lib/db` or anything Node-only.
 */
import { MEMORY_WRITER_AGENT_TYPES } from "@/lib/workflow/dreaming-constants";
import { REFINEMENT_AGENT_TYPE } from "@/lib/refinement/constants";

/** The dispatch role of a live session, as the monitor draws it. */
export type UnifiedActivityType =
  | "build"
  | "review"
  | "merge"
  | "chat"
  | "spec_generation"
  | "release"
  | "memory"
  | "qa"
  | "grading"
  | "refinement";

export interface UnifiedActivity {
  id: string;
  epicId: string | null;
  userStoryId: string | null;
  type: UnifiedActivityType;
  label: string;
  status: string;
  mode: string;
  provider: string;
  namedAgentName: string | null;
  startedAt: string;
  source: "db" | "registry";
  cancellable: boolean;
  /**
   * Freshest lifecycle/output signal for DB sessions, using the same
   * definition as the sessions list. Registry activities return null because
   * they stream outside the durable session/chunk stores.
   */
  lastActivityAt: string | null;
  /**
   * True when lastActivityAt is older than the session's watchdog threshold
   * (settings `watchdog_threshold_minutes[:<agentType>]`, default 5m) —
   * same predicate the watchdog uses to notify, so the monitor's amber
   * state and the stall notification always agree.
   */
  stale: boolean;
}

export type SessionClassificationRow = {
  agentType: string | null;
  orchestrationMode: string | null;
  mode: string | null;
};

/**
 * The one classification of a session row into a dispatch role. Both the
 * monitor route (`inferDbActivityType`) and the desk read model
 * (`lib/control-desk/aggregate.ts`'s `inferTaskType`) read it, so the two
 * surfaces cannot disagree about what a running agent is doing — they only
 * differ in how they spell the result.
 *
 * The order is the whole contract:
 *  - `release_notes` / `grading` / `refinement` are their own roles.
 *  - `review_*` before the mode heuristic: review agents run in code mode.
 *  - memory writers and QA before the `mode === "plan"` fallback, which would
 *    otherwise file a memory rewrite as a review.
 *  - `merge` by agent type, then the team/mode heuristics, then build.
 *
 * The prompt-substring tests that used to sit in the fallback (searching
 * `agent_sessions.prompt` for "merge conflict" / the review header) were
 * removed: the route's docblock records the measurement and the 389-session
 * false-positive study that retired them.
 */
export function classifySessionActivity(
  row: SessionClassificationRow,
): UnifiedActivityType {
  const agentType = row.agentType ?? "";

  if (agentType === "release_notes") return "release";
  if (agentType === "grading") return "grading";
  if (agentType === REFINEMENT_AGENT_TYPE) return "refinement";
  if (agentType.startsWith("review_")) return "review";

  if (
    agentType === "tech_check" ||
    agentType === "e2e_test" ||
    agentType === "failure_digest"
  ) {
    return "qa";
  }

  if (agentType && MEMORY_WRITER_AGENT_TYPES.includes(agentType)) {
    return "memory";
  }

  if (agentType === "merge") return "merge";

  if (row.orchestrationMode === "team") return "build";
  if (row.mode === "plan") return "review";
  return "build";
}
