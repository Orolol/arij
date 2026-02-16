/**
 * Idempotent backfill for readable ticket IDs.
 * Only assigns where readableId is null, preserving immutability.
 * Uses stable ordering (createdAt, then id) for determinism.
 */

import { db, sqlite } from "@/lib/db";
import { epics, projects } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { generateReadableId } from "./readable-id";

export function backfillReadableIds(): { updated: number } {
  let updated = 0;

  const allProjects = db.select().from(projects).all();

  for (const project of allProjects) {
    // Get all epics without a readable ID, ordered stably
    const unassigned = db
      .select({
        id: epics.id,
        type: epics.type,
      })
      .from(epics)
      .where(
        sql`${epics.projectId} = ${project.id} AND ${epics.readableId} IS NULL`
      )
      .orderBy(epics.createdAt, epics.id)
      .all();

    for (const epic of unassigned) {
      const readableId = generateReadableId(
        project.id,
        project.name,
        (epic.type as "feature" | "bug") || "feature",
      );

      db.update(epics)
        .set({ readableId })
        .where(eq(epics.id, epic.id))
        .run();

      updated++;
    }
  }

  return { updated };
}
