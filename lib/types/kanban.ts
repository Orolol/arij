import type { TranslationKey } from "@/lib/i18n/catalogue";

export const KANBAN_COLUMNS = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "to_merge",
  "done",
  "released",
] as const;

export type KanbanStatus = (typeof KANBAN_COLUMNS)[number];

export const COLUMN_LABEL_KEYS: Record<KanbanStatus, TranslationKey> = {
  backlog: "Kanban.columns.backlog",
  todo: "Kanban.columns.todo",
  in_progress: "Kanban.columns.in_progress",
  review: "Kanban.columns.review",
  to_merge: "Kanban.columns.to_merge",
  done: "Kanban.columns.done",
  released: "Kanban.columns.released",
};

/**
 * Statuses a build agent may be dispatched from. `done` and `released` are
 * terminal delivery states: there is nothing left for a build agent to do,
 * and as a *dependency* such a ticket is an already-SATISFIED prerequisite —
 * it must never be rebuilt by a batch, and it must never hold its dependents
 * back (a ticket whose only prerequisites are done belongs to wave 1).
 */
export const BUILDABLE_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "to_merge",
] as const;

const BUILDABLE_STATUS_SET: ReadonlySet<string> = new Set(BUILDABLE_STATUSES);

/** Whether a ticket status still admits a build agent (see BUILDABLE_STATUSES). */
export function isBuildableStatus(status: string | null | undefined): boolean {
  return status != null && BUILDABLE_STATUS_SET.has(status);
}

/**
 * Terminal delivery states. A ticket here has shipped: nothing left to build,
 * and as a *prerequisite* it is already satisfied.
 *
 * This is deliberately not "the complement of BUILDABLE_STATUSES", and the
 * two predicates answer different questions. `isBuildableStatus` asks "may an
 * agent still be dispatched here?" and answers *no* for an unknown status.
 * `isDeliveredStatus` asks "did this prerequisite ship?" and must also answer
 * *no* for an unknown status — blocking a dependent is the conservative
 * direction, whereas negating the buildable check would silently unblock it.
 */
export const DELIVERED_STATUSES = ["done", "released"] as const;

const DELIVERED_STATUS_SET: ReadonlySet<string> = new Set(DELIVERED_STATUSES);

/**
 * Whether a ticket has shipped, i.e. whether it satisfies a dependency edge
 * pointing at it. The single definition of "delivered": dependency gates
 * (lib/dependencies/validation.ts), the board's execution queue
 * (lib/kanban/queue.ts) and the Full Auto selector all read it, so adding a
 * terminal status updates every consumer at once.
 */
export function isDeliveredStatus(status: string | null | undefined): boolean {
  return status != null && DELIVERED_STATUS_SET.has(status);
}

export const PRIORITY_LABEL_KEYS: Record<number, TranslationKey> = {
  0: "Kanban.priorities.low",
  1: "Kanban.priorities.medium",
  2: "Kanban.priorities.high",
  3: "Kanban.priorities.critical",
};

/**
 * A project ticket-dependency edge (`ticket_dependencies` row, epic-level):
 * `ticketId` depends on `dependsOnTicketId`.
 */
export interface TicketDependencyEdge {
  ticketId: string;
  dependsOnTicketId: string;
}

export const USER_STORY_STATUSES = ["todo", "in_progress", "review", "done"] as const;
export type UserStoryStatus = (typeof USER_STORY_STATUSES)[number];

/**
 * The row `GET /api/projects/:id/epics` returns, for the four client views
 * that read the LIST payload (`components/releases/derive.ts`,
 * `components/night/NightRunDialog.tsx`, `hooks/useProjectEpicsList.ts`,
 * `hooks/useTicketOverlayData.ts`). Each used to redeclare its own guess, so
 * a renamed column broke nothing at compile time; they now derive from this
 * by `Pick`.
 *
 * The single-ticket GET has its own projection (`hooks/useEpicDetail.ts`),
 * which is a different contract and is not this type.
 */
export interface ProjectEpicListRow {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  position: number;
  type: string;
  readableId: string | null;
  releaseId: string | null;
  createdAt: string;
  updatedAt: string;
  usCount: number;
  usDone: number;
  latestSessionOutcome: string | null;
}

/**
 * A MODULE-SCOPE COPY TABLE, so it holds catalogue KEY REFERENCES rather than
 * words: it is evaluated at import time and cannot call a hook, and the panel
 * that draws it resolves each key with the namespace-less translator
 * (`lib/i18n/catalogue.ts`, pattern 3).
 */
export const USER_STORY_STATUS_LABELS: Record<
  UserStoryStatus,
  { labelKey: TranslationKey }
> = {
  todo: { labelKey: "Story.status.todo" },
  in_progress: { labelKey: "Story.status.inProgress" },
  review: { labelKey: "Story.status.review" },
  done: { labelKey: "Story.status.done" },
};
