/** Static build eligibility shared by the execution queue and Full Auto. */
export const BUILDABLE_EPIC_STATUSES: ReadonlySet<string> = new Set(["todo", "in_progress"]);
export const BUILDABLE_STORY_STATUSES: ReadonlySet<string> = new Set(["todo", "in_progress"]);
export const STORY_PARENT_BUILDABLE_STATUSES: ReadonlySet<string> = new Set([
  "todo", "in_progress", "review", "to_merge",
]);

interface BuildStory {
  id: string;
  status: string | null;
  position: number | null;
}

/**
 * A storyless epic is its own work unit. Once it has stories, only an
 * eligible story can supply work; reviewing or backlogged stories do not
 * turn into an implicit whole-epic rebuild. Runtime ownership and parking
 * remain the caller's policy, supplied through isStoryExcluded.
 */
export function selectBuildWork<T extends BuildStory>(
  epicStatus: string | null,
  stories: readonly T[],
  isStoryExcluded: (story: T) => boolean = () => false,
): { scope: "epic" } | { scope: "story"; story: T } | null {
  if (stories.length === 0) {
    return BUILDABLE_EPIC_STATUSES.has(epicStatus ?? "") ? { scope: "epic" } : null;
  }
  if (!STORY_PARENT_BUILDABLE_STATUSES.has(epicStatus ?? "")) return null;
  const next = [...stories]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .find((story) => BUILDABLE_STORY_STATUSES.has(story.status ?? "") && !isStoryExcluded(story));
  return next ? { scope: "story", story: next } : null;
}

export type BuildQueueHold = "owned" | "busy" | "parked" | "review_rejections";

export interface BuildQueueFacts {
  hold?: BuildQueueHold | null;
  available: boolean;
  awaitingReply: boolean;
}
