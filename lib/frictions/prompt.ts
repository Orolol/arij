import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { frictions } from "@/lib/db/schema";
import { OPEN_FRICTION_STATUSES } from "./constants";

export interface ProjectFrictionSummary {
  id: string;
  category: string;
  description: string;
  filePath: string | null;
  occurrences: number;
}

/**
 * Loads the most prominent open frictions for a project so they can be injected into agent prompts.
 */
export function loadActiveProjectFrictions(
  projectId: string,
  limit = 5,
): ProjectFrictionSummary[] {
  try {
    return db
      .select({
        id: frictions.id,
        category: frictions.category,
        description: frictions.description,
        filePath: frictions.filePath,
        occurrences: frictions.occurrences,
      })
      .from(frictions)
      .where(
        and(
          eq(frictions.projectId, projectId),
          inArray(frictions.status, [...OPEN_FRICTION_STATUSES]),
        ),
      )
      .orderBy(desc(frictions.occurrences), desc(frictions.createdAt))
      .limit(limit)
      .all();
  } catch {
    return [];
  }
}

/**
 * Builds a prompt section highlighting known repository frictions to close the feedback loop.
 */
export function frictionsPromptSection(activeFrictions: ProjectFrictionSummary[]): string {
  if (!activeFrictions || activeFrictions.length === 0) return "";
  const lines = activeFrictions.map((f) => {
    const target = f.filePath ? ` (file: \`${f.filePath}\`)` : "";
    return `- [${f.category}] ${f.description.trim()}${target} (reported ${f.occurrences}x)`;
  });

  return `## Known Repository Frictions\n\nPrevious agent sessions encountered these active obstacles in this repository. Take them into account to avoid repeating known issues:\n\n${lines.join("\n")}\n`;
}
