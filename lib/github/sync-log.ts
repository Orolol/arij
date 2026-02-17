import { db } from "@/lib/db";
import { gitSyncLog } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";
import { eq, desc } from "drizzle-orm";

export type GitSyncOperation =
  | "detect"
  | "fetch"
  | "pull"
  | "push"
  | "pr_create"
  | "pr_sync"
  | "release"
  | "tag_push"
  | "issues_sync";

export type GitSyncStatus = "success" | "failed" | "failure";

interface LogSyncOperationInput {
  projectId: string;
  operation: GitSyncOperation;
  status: GitSyncStatus;
  branch?: string | null;
  detail?: string | Record<string, unknown> | null;
}

export function logSyncOperation(input: LogSyncOperationInput): void {
  const now = new Date().toISOString();
  const detail =
    input.detail == null
      ? null
      : typeof input.detail === "string"
        ? input.detail
        : JSON.stringify(input.detail);

  try {
    db.insert(gitSyncLog)
      .values({
        id: createId(),
        projectId: input.projectId,
        operation: input.operation,
        status: input.status,
        branch: input.branch ?? null,
        detail,
        createdAt: now,
      })
      .run();
  } catch (error) {
    console.warn("[git/sync-log] failed to write audit row", error);
  }
}

/** Alias kept for backward compat with main's naming */
export const writeGitSyncLog = logSyncOperation;

export function getRecentSyncLogs(projectId: string, limit = 50) {
  return db
    .select()
    .from(gitSyncLog)
    .where(eq(gitSyncLog.projectId, projectId))
    .orderBy(desc(gitSyncLog.createdAt))
    .limit(limit)
    .all();
}
