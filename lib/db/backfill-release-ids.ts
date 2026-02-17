/**
 * Idempotent backfill for releaseId on epics.
 * Populates releaseId for epics with status "released" from the releases table's epicIds JSON.
 */

import { db } from "@/lib/db";
import { epics, releases } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export function backfillReleasedEpicIds(): { updated: number } {
  let updated = 0;

  // Find all releases with their epicIds
  const allReleases = db
    .select({
      id: releases.id,
      epicIds: releases.epicIds,
    })
    .from(releases)
    .all();

  for (const release of allReleases) {
    if (!release.epicIds) continue;

    try {
      const epicIds: string[] = JSON.parse(release.epicIds);
      
      for (const epicId of epicIds) {
        // Check if this epic exists, is in "released" status, and has no releaseId yet
        const epic = db
          .select({ id: epics.id, releaseId: epics.releaseId, status: epics.status })
          .from(epics)
          .where(eq(epics.id, epicId))
          .get();

        if (epic && !epic.releaseId && epic.status === "released") {
          db.update(epics)
            .set({ releaseId: release.id })
            .where(eq(epics.id, epicId))
            .run();
          updated++;
        }
      }
    } catch {
      // Skip invalid JSON
    }
  }

  return { updated };
}
