import { db } from "@/lib/db";
import { projects, epics, userStories, ticketComments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { writeArjiJson } from "./arji-json";
import type { ArjiJson, ArjiJsonEpic, ArjiJsonComment } from "./arji-json";

function toJsonComment(c: { id: string; author: string; content: string; createdAt: string | null }): ArjiJsonComment {
  return { id: c.id, author: c.author, content: c.content, createdAt: c.createdAt };
}

export async function exportArjiJson(projectId: string): Promise<void> {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project || !project.gitRepoPath) return;

  const allEpics = db
    .select()
    .from(epics)
    .where(eq(epics.projectId, projectId))
    .orderBy(epics.status, epics.position)
    .all();

  const epicList: ArjiJsonEpic[] = allEpics.map((epic) => {
    const stories = db
      .select()
      .from(userStories)
      .where(eq(userStories.epicId, epic.id))
      .orderBy(userStories.position)
      .all();

    const epicComments = db
      .select()
      .from(ticketComments)
      .where(eq(ticketComments.epicId, epic.id))
      .all();

    return {
      id: epic.id,
      title: epic.title,
      description: epic.description,
      priority: epic.priority ?? 0,
      status: epic.status ?? "backlog",
      position: epic.position ?? 0,
      branchName: epic.branchName,
      type: epic.type ?? "feature",
      user_stories: stories.map((us) => {
        const storyComments = db
          .select()
          .from(ticketComments)
          .where(eq(ticketComments.userStoryId, us.id))
          .all();

        return {
          id: us.id,
          title: us.title,
          description: us.description,
          acceptance_criteria: us.acceptanceCriteria,
          status: us.status ?? "todo",
          position: us.position ?? 0,
          ...(storyComments.length > 0 && {
            comments: storyComments.map(toJsonComment),
          }),
        };
      }),
      ...(epicComments.length > 0 && {
        comments: epicComments.map(toJsonComment),
      }),
    };
  });

  const data: ArjiJson = {
    version: 1,
    lastSyncedAt: new Date().toISOString(),
    project: {
      name: project.name,
      description: project.description,
      status: project.status ?? "ideation",
      spec: project.spec,
    },
    epics: epicList,
  };

  await writeArjiJson(project.gitRepoPath, data);
}

/** Fire-and-forget wrapper — never throws, never blocks the caller. */
export function tryExportArjiJson(projectId: string): void {
  exportArjiJson(projectId).catch((err) =>
    console.warn("[sync/export] failed:", err)
  );
}
