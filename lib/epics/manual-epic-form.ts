/**
 * Draft model for the manual epic form (`EpicCreateDialog`).
 *
 * Kept free of React so the rules the dialog enforces before it fires a
 * request are unit-testable on their own, and so the payload it sends matches
 * `createEpicSchema` without the component having to know that schema.
 */

export interface ManualUserStoryDraft {
  /** Client-side key only — the server mints the persisted story id. */
  key: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
}

export interface ManualEpicDraft {
  title: string;
  description: string;
  userStories: ManualUserStoryDraft[];
}

export interface ManualEpicValidation {
  valid: boolean;
  /** Set when the epic title is missing; `null` when it is fine. */
  titleError: string | null;
  /** Keyed by `ManualUserStoryDraft.key` — only untitled stories appear. */
  storyErrors: Record<string, string>;
}

export interface ManualEpicPayload {
  title: string;
  description: string | null;
  status: "backlog";
  type: "feature";
  userStories: Array<{
    title: string;
    description: string | null;
    acceptanceCriteria: string | null;
  }>;
}

export const EPIC_TITLE_REQUIRED = "Title is required";
export const STORY_TITLE_REQUIRED = "User story title is required";

export function createEmptyUserStory(key: string): ManualUserStoryDraft {
  return { key, title: "", description: "", acceptanceCriteria: "" };
}

export function createEmptyEpicDraft(): ManualEpicDraft {
  return { title: "", description: "", userStories: [] };
}

/**
 * Epic title is required; every story the user chose to add must be titled.
 * Zero user stories is a valid epic — the form is a faster path to a ticket,
 * not a contract to fill in.
 */
export function validateManualEpicDraft(draft: ManualEpicDraft): ManualEpicValidation {
  const titleError = draft.title.trim().length === 0 ? EPIC_TITLE_REQUIRED : null;

  const storyErrors: Record<string, string> = {};
  for (const story of draft.userStories) {
    if (story.title.trim().length === 0) {
      storyErrors[story.key] = STORY_TITLE_REQUIRED;
    }
  }

  return {
    valid: titleError === null && Object.keys(storyErrors).length === 0,
    titleError,
    storyErrors,
  };
}

const trimmedOrNull = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Shapes a validated draft for `POST /api/projects/:projectId/epics`, which
 * creates the epic and its stories in one transaction — no orphan epic if a
 * story insert fails.
 */
export function buildManualEpicPayload(draft: ManualEpicDraft): ManualEpicPayload {
  return {
    title: draft.title.trim(),
    description: trimmedOrNull(draft.description),
    status: "backlog",
    type: "feature",
    userStories: draft.userStories.map((story) => ({
      title: story.title.trim(),
      description: trimmedOrNull(story.description),
      acceptanceCriteria: trimmedOrNull(story.acceptanceCriteria),
    })),
  };
}
