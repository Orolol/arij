import type { ArijDatabase } from "@/lib/db";
import { generateReadableId } from "@/lib/db/readable-id";
import { epics, userStories } from "@/lib/db/schema";
/** Called inside the creation transaction so ids, stories and counters commit together. */
export function insertEpicWithStories(
  tx: Pick<ArijDatabase, "insert">,
  projectName: string,
  epic: typeof epics.$inferInsert,
  stories: Array<typeof userStories.$inferInsert>,
) {
  const readableId = generateReadableId(epic.projectId, projectName, epic.type === "bug" ? "bug" : "feature");
  const row = { ...epic, readableId };
  tx.insert(epics).values(row).run();
  if (stories.length) tx.insert(userStories).values(stories).run();
  return row;
}
