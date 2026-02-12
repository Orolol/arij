import { db } from "@/lib/db";
import { gitSyncLog } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";

interface LogSyncParams {
  projectId: string;
  operation: string; // push | pull | fetch | tag | pr | release
  branch?: string;
  status: "success" | "failure";
  detail?: string;
}

/**
 * Inserts a sync operation entry into the git_sync_log table.
 */
export function logSyncOperation(params: LogSyncParams): void {
  db.insert(gitSyncLog)
    .values({
      id: createId(),
      projectId: params.projectId,
      operation: params.operation,
      branch: params.branch ?? null,
      status: params.status,
      detail: params.detail ?? null,
    })
    .run();
}

/**
 * Returns recent sync log entries for a project, ordered by most recent first.
 */
export function getRecentSyncLogs(
  projectId: string,
  limit: number = 20
) {
  return db
    .select()
    .from(gitSyncLog)
    .where(eq(gitSyncLog.projectId, projectId))
    .orderBy(desc(gitSyncLog.createdAt))
    .limit(limit)
    .all();
}
