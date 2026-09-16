import { db } from "@/lib/db";
import { epics, type Routine } from "@/lib/db/schema";
import {
  isGitHubIssueSyncDue,
  syncProjectGitHubIssues,
} from "@/lib/github/issues";
import { runCiWatchRoutine } from "@/lib/routines/ci-watch";
import { parseRoutineConfig } from "@/lib/routines/constants";
import { runRetentionRoutine } from "@/lib/routines/retention";
import { batchBuildSchema, type NightRunRequest } from "@/lib/validation/build-schemas";
import { and, eq, inArray } from "drizzle-orm";

/** Result persisted and surfaced by the routine scheduler. */
export interface RoutineActionResult {
  status: "completed" | "skipped" | "failed";
  message: string;
  targetUrl: string;
  /**
   * Daily actions omit this and notify every trigger. High-frequency polling
   * actions may suppress a quiet result while retaining lastRunAt/lastStatus
   * and the scheduler log entry.
   */
  shouldNotify?: boolean;
}


export interface RoutineActionDeps {
  listNightRunEpicIds(
    projectId: string,
    statuses: Array<"todo" | "backlog">,
  ): string[];
  launchNightRun(
    projectId: string,
    request: NightRunRequest,
  ): Promise<{
    batchId: string;
    totalEpics: number;
    waves: number;
  }>;
  isGitHubIssueSyncDue(projectId: string, intervalMinutes: number): boolean;
  syncProjectGitHubIssues(projectId: string): Promise<{ synced: number }>;
  runCiWatch(routine: Routine): Promise<RoutineActionResult>;
  runRetention(routine: Routine): Promise<RoutineActionResult>;
}

/**
 * Invoke the shared batch-build service in its canonical Night Run mode.
 * Keeping the hand-off here means scheduled runs receive the exact same
 * repository, workflow, concurrency, dependency and active-run guards as a
 * run started from the dialog.
 */
async function launchNightRun(
  projectId: string,
  requestBody: NightRunRequest,
): Promise<{ batchId: string; totalEpics: number; waves: number }> {
  const { dispatchBatchBuild } = await import("@/lib/build/dispatch");
  const response = await dispatchBatchBuild(projectId, requestBody);
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    data?: { batchId?: string; totalEpics?: number; waves?: number };
  };

  if (!response.ok || payload.error) {
    throw new Error(payload.error || "Failed to start the night run");
  }

  const batchId = payload.data?.batchId;
  if (!batchId) {
    throw new Error("Night run started without a batch id");
  }
  return {
    batchId,
    totalEpics: Number(payload.data?.totalEpics ?? requestBody.epicIds.length),
    waves: Number(payload.data?.waves ?? 0),
  };
}

export const defaultRoutineActionDeps: RoutineActionDeps = {
  listNightRunEpicIds: (projectId, statuses) =>
    db
      .select({ id: epics.id })
      .from(epics)
      .where(
        and(eq(epics.projectId, projectId), inArray(epics.status, statuses)),
      )
      .orderBy(epics.position)
      .all()
      .map((row) => row.id),
  launchNightRun: launchNightRun,
  isGitHubIssueSyncDue,
  syncProjectGitHubIssues,
  runCiWatch: runCiWatchRoutine,
  runRetention: (routine) => runRetentionRoutine(routine),
};

function optionalBoolean(
  config: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = config[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new Error(`Routine config.${key} must be a boolean`);
  }
  return value;
}

function parseNightRunRequest(
  routine: Routine,
  deps: RoutineActionDeps,
): NightRunRequest | null {
  const config = parseRoutineConfig(routine);
  const includeBacklog = optionalBoolean(config, "includeBacklog", false);
  const statuses: Array<"todo" | "backlog"> = includeBacklog
    ? ["todo", "backlog"]
    : ["todo"];
  const epicIds = deps.listNightRunEpicIds(routine.projectId, statuses);
  if (epicIds.length === 0) return null;

  return batchBuildSchema.parse({ ...config, epicIds, mode: "dag", pipeline: true });

}

async function runNightRoutine(
  routine: Routine,
  deps: RoutineActionDeps,
): Promise<RoutineActionResult> {
  const request = parseNightRunRequest(routine, deps);
  if (!request) {
    return {
      status: "skipped",
      message: "No eligible To Do epics were available for the night run.",
      targetUrl: `/projects/${routine.projectId}`,
    };
  }

  const result = await deps.launchNightRun(routine.projectId, request);
  return {
    status: "completed",
    message: `Night run ${result.batchId} started for ${result.totalEpics} epic${
      result.totalEpics === 1 ? "" : "s"
    } across ${result.waves} wave${result.waves === 1 ? "" : "s"}.`,
    targetUrl: `/projects/${routine.projectId}?nightRun=${encodeURIComponent(
      result.batchId,
    )}`,
  };
}

async function runGitHubIssueSyncRoutine(
  routine: Routine,
  deps: RoutineActionDeps,
): Promise<RoutineActionResult> {
  const config = parseRoutineConfig(routine);
  const configuredInterval = config.intervalMinutes ?? 15;
  if (
    !Number.isInteger(configuredInterval) ||
    (configuredInterval as number) < 1
  ) {
    throw new Error(
      "Routine config.intervalMinutes must be a positive integer",
    );
  }
  const intervalMinutes = configuredInterval as number;

  if (!deps.isGitHubIssueSyncDue(routine.projectId, intervalMinutes)) {
    return {
      status: "skipped",
      message: `GitHub issue sync is still fresh (TTL ${intervalMinutes} minutes).`,
      targetUrl: `/projects/${routine.projectId}/github-issues`,
    };
  }

  const result = await deps.syncProjectGitHubIssues(routine.projectId);
  return {
    status: "completed",
    message: `Synchronized ${result.synced} open GitHub issue${
      result.synced === 1 ? "" : "s"
    }.`,
    targetUrl: `/projects/${routine.projectId}/github-issues`,
  };
}

/** Execute one currently supported routine kind through its canonical service. */
export async function executeRoutineAction(
  routine: Routine,
  deps: RoutineActionDeps = defaultRoutineActionDeps,
): Promise<RoutineActionResult> {
  switch (routine.kind) {
    case "night_run":
      return runNightRoutine(routine, deps);
    case "github_issue_sync":
      return runGitHubIssueSyncRoutine(routine, deps);
    case "ci_watch":
      return deps.runCiWatch(routine);
    case "retention":
      return deps.runRetention(routine);
    case "dreaming":
      throw new Error(`Routine kind ${routine.kind} is not available yet`);
  }
}
