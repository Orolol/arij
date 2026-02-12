import { db } from "@/lib/db";
import { gitSyncLog } from "@/lib/db/schema";
import { createId } from "@/lib/utils/nanoid";

export type SyncOperation =
  | "push"
  | "pull"
  | "fetch"
  | "pr_create"
  | "pr_sync"
  | "release_create"
  | "release_publish"
  | "tag_push";

export type SyncStatus = "success" | "failure";

/**
 * Inserts a record into the git_sync_log table.
 */
export function logSyncOperation(
  projectId: string,
  operation: SyncOperation,
  branch: string | null,
  status: SyncStatus,
  detail?: Record<string, unknown>
): void {
  db.insert(gitSyncLog)
    .values({
      id: createId(),
      projectId,
      operation,
      branch,
      status,
      detail: detail ? JSON.stringify(detail) : null,
      createdAt: new Date().toISOString(),
    })
    .run();
}
