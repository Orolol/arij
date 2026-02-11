import { db } from "@/lib/db";
import { projects, epics, userStories } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readArjiJson } from "./arji-json";
import Database from "better-sqlite3";

export interface ImportResult {
  epicsUpserted: number;
  epicsRemoved: number;
  storiesUpserted: number;
  storiesRemoved: number;
}

export async function importArjiJson(projectId: string): Promise<ImportResult> {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new Error("Project not found");
  if (!project.gitRepoPath) throw new Error("Project has no gitRepoPath");

  const data = await readArjiJson(project.gitRepoPath);
  if (!data) throw new Error("arji.json not found in repo");

  const now = new Date().toISOString();

  // Update project fields from JSON
  db.update(projects)
    .set({
      name: data.project.name,
      description: data.project.description,
      status: data.project.status,
      spec: data.project.spec,
      updatedAt: now,
    })
    .where(eq(projects.id, projectId))
    .run();

  // Run epic + story sync inside a transaction
  const sqlite = (db as unknown as { $client: Database.Database }).$client;

  let epicsUpserted = 0;
  let epicsRemoved = 0;
  let storiesUpserted = 0;
  let storiesRemoved = 0;

  const transaction = sqlite.transaction(() => {
    // Get current epic IDs for this project
    const currentEpics = db
      .select({ id: epics.id })
      .from(epics)
      .where(eq(epics.projectId, projectId))
      .all();
    const currentEpicIds = new Set(currentEpics.map((e) => e.id));
    const jsonEpicIds = new Set(data.epics.map((e) => e.id));

    // Upsert epics
    for (const epic of data.epics) {
      if (currentEpicIds.has(epic.id)) {
        db.update(epics)
          .set({
            title: epic.title,
            description: epic.description,
            priority: epic.priority,
            status: epic.status,
            position: epic.position,
            branchName: epic.branchName,
            updatedAt: now,
          })
          .where(eq(epics.id, epic.id))
          .run();
      } else {
        db.insert(epics)
          .values({
            id: epic.id,
            projectId,
            title: epic.title,
            description: epic.description,
            priority: epic.priority,
            status: epic.status,
            position: epic.position,
            branchName: epic.branchName,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
      epicsUpserted++;

      // Sync user stories within this epic
      const currentStories = db
        .select({ id: userStories.id })
        .from(userStories)
        .where(eq(userStories.epicId, epic.id))
        .all();
      const currentStoryIds = new Set(currentStories.map((s) => s.id));
      const jsonStoryIds = new Set(epic.user_stories.map((s) => s.id));

      for (const story of epic.user_stories) {
        if (currentStoryIds.has(story.id)) {
          db.update(userStories)
            .set({
              title: story.title,
              description: story.description,
              acceptanceCriteria: story.acceptance_criteria,
              status: story.status,
              position: story.position,
            })
            .where(eq(userStories.id, story.id))
            .run();
        } else {
          db.insert(userStories)
            .values({
              id: story.id,
              epicId: epic.id,
              title: story.title,
              description: story.description,
              acceptanceCriteria: story.acceptance_criteria,
              status: story.status,
              position: story.position,
              createdAt: now,
            })
            .run();
        }
        storiesUpserted++;
      }

      // Delete stories not in JSON
      for (const id of currentStoryIds) {
        if (!jsonStoryIds.has(id)) {
          db.delete(userStories).where(eq(userStories.id, id)).run();
          storiesRemoved++;
        }
      }
    }

    // Delete epics not in JSON
    for (const id of currentEpicIds) {
      if (!jsonEpicIds.has(id)) {
        db.delete(epics).where(eq(epics.id, id)).run();
        epicsRemoved++;
      }
    }
  });

  transaction();

  return { epicsUpserted, epicsRemoved, storiesUpserted, storiesRemoved };
}
