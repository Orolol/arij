export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateEpicTitle(title: string): ValidationResult {
  const errors: string[] = [];

  if (!title || title.trim().length === 0) {
    errors.push("Title is required");
  } else if (title.trim().length < 3) {
    errors.push("Title must be at least 3 characters");
  } else if (title.trim().length > 200) {
    errors.push("Title must be at most 200 characters");
  }

  return { valid: errors.length === 0, errors };
}

export function validateStoryPoints(points: unknown): ValidationResult {
  const errors: string[] = [];

  if (points === undefined || points === null) {
    return { valid: true, errors };
  }

  if (typeof points !== "number" || !Number.isInteger(points)) {
    errors.push("Story points must be an integer");
  } else if (points < 1 || points > 100) {
    errors.push("Story points must be between 1 and 100");
  }

  return { valid: errors.length === 0, errors };
}

const VALID_STATUSES = [
  "backlog",
  "todo",
  "in-progress",
  "review",
  "done",
] as const;
export type StoryStatus = (typeof VALID_STATUSES)[number];

export function validateStatus(status: string): ValidationResult {
  const errors: string[] = [];

  if (!VALID_STATUSES.includes(status as StoryStatus)) {
    errors.push(
      `Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(", ")}`
    );
  }

  return { valid: errors.length === 0, errors };
}
