import { db } from "@/lib/db";
import { documents, epics, projects } from "@/lib/db/schema";
import { removeTicketWorktree } from "@/lib/git/manager";
import { captureTicketSnapshot, formatTicketSnapshot, retireTicket } from "@/lib/refinement/retire";
import { createId } from "@/lib/utils/nanoid";
import { eq } from "drizzle-orm";
import { assertTicketIdle, ScopedDeleteNotFoundError } from "./permanent-delete";

export async function deleteTicket(projectId: string, epicId: string) {
  const epic = db.select().from(epics).where(eq(epics.id, epicId)).get();
  if (!epic || epic.projectId !== projectId) throw new ScopedDeleteNotFoundError("Epic not found");
  assertTicketIdle(epicId);
  const snapshot = captureTicketSnapshot(projectId, epic);
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (epic.branchName && project?.gitRepoPath) {
    await removeTicketWorktree(project.gitRepoPath, epic.branchName);
  }
  db.transaction(() => {
    assertTicketIdle(epicId);
    db.insert(documents).values({ id: createId(), projectId,
      originalFilename: `Deleted ticket ${epic.readableId ?? epic.id}`,
      kind: "text", markdownContent: formatTicketSnapshot(snapshot),
    }).run();
    retireTicket(projectId, epicId);
  });
}
