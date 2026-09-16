import { eq } from "drizzle-orm";
import { db as defaultDb, type ArijDatabase } from "@/lib/db";
import { documents, epics, projects, userStories } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";

export class ProjectSpecChangedError extends Error {
  constructor() {
    super("The specification changed while the agent was running. Your newer edits were preserved.");
    this.name = "ProjectSpecChangedError";
  }
}

export interface GeneratedSpec {
  spec?: string;
  epics?: Array<{
    title: string;
    description?: string;
    priority?: number;
    status?: string;
    user_stories?: Array<{
      title: string;
      description?: string;
      acceptance_criteria?: string;
      status?: string;
    }>;
  }>;
}

/** Commit a proposal against the spec it reasoned from, including every ticket. */
export function commitGeneratedSpec(
  projectId: string,
  expectedSpec: string | null,
  generated: GeneratedSpec,
  options: { database?: ArijDatabase; updatedAt?: string; status?: string } = {},
): number {
  const database = options.database ?? defaultDb;
  const now = options.updatedAt ?? new Date().toISOString();
  return database.transaction((tx) => {
    const current = tx.select({ spec: projects.spec }).from(projects).where(eq(projects.id, projectId)).get();
    if (!current) throw new Error("Project no longer exists.");
    if ((current.spec ?? "") !== (expectedSpec ?? "")) throw new ProjectSpecChangedError();
    if (generated.spec !== undefined) {
      tx.update(projects).set({
        spec: generated.spec,
        updatedAt: now,
        ...(options.status ? { status: options.status } : {}),
      }).where(eq(projects.id, projectId)).run();
    }
    for (const [position, epic] of (generated.epics ?? []).entries()) {
      const epicId = createId();
      tx.insert(epics).values({
        id: epicId, projectId, title: epic.title, description: epic.description ?? null,
        priority: epic.priority ?? 0, status: epic.status || "backlog", position,
        createdAt: now, updatedAt: now,
      }).run();
      for (const [storyPosition, story] of (epic.user_stories ?? []).entries()) {
        tx.insert(userStories).values({
          id: createId(), epicId, title: story.title, description: story.description ?? null,
          acceptanceCriteria: story.acceptance_criteria ?? null, status: story.status || "todo",
          position: storyPosition, createdAt: now,
        }).run();
      }
    }
    return generated.epics?.length ?? 0;
  });
}

/** Legacy generation has no session: keep a rejected proposal recoverable. */
export function saveConflictingSpecProposal(projectId: string, output: string, database = defaultDb) {
  const id = createId();
  const filename = `spec-proposal-${id}.md`;
  database.insert(documents).values({
    id, projectId, originalFilename: filename,
    // Reference-document defaults only inject kind="text". This output is
    // available for explicit @mentions, but never silently becomes context.
    kind: "spec_proposal", markdownContent: output, mimeType: "text/markdown",
    sizeBytes: Buffer.byteLength(output, "utf8"),
  }).run();
  return { id, filename };
}
