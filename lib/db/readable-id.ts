/**
 * Readable ticket ID generation with shared per-project counter.
 * Format: E-<slug>-NNN (features) or B-<slug>-NNN (bugs)
 */

import { sqlite } from "@/lib/db";

/**
 * Generates and assigns a readable ID for a new ticket.
 * Uses an atomic increment on the project's ticket_counter column.
 * Must be called inside a transaction or protected by the caller.
 */
export function generateReadableId(
  projectId: string,
  projectName: string,
  type: "feature" | "bug",
): string {
  const prefix = type === "bug" ? "B" : "E";
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);

  // Atomically increment and return the new counter value
  const result = sqlite
    .prepare(
      "UPDATE projects SET ticket_counter = COALESCE(ticket_counter, 0) + 1 WHERE id = ? RETURNING ticket_counter"
    )
    .get(projectId) as { ticket_counter: number } | undefined;

  const counter = result?.ticket_counter ?? 1;
  const padded = String(counter).padStart(3, "0");

  return `${prefix}-${slug}-${padded}`;
}
