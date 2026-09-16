import { isPipelineRunActive } from "@/lib/pipeline/constants";
import { listPipelineRunsByProject } from "@/lib/pipeline/registry";
import { dagBatchRegistry } from "@/lib/agents/dag-batch-registry";
import { nightRunRegistry } from "@/lib/night/registry";
import { autoModeRegistry } from "./registry";
import { AUTO_MODE_MAX_REVIEW_REJECTIONS } from "./constants";
import type { BuildQueueHold } from "@/lib/kanban/build-work";

/**
 * Live in-memory owners of a ticket. Pipeline runs and night runs carry the
 * epics they own, so exclusion is per epic. A DAG wave batch does not
 * (DagBatchSnapshot has counts, not an epic list), so an active one blocks
 * the whole project — the same project-wide stance the batch route takes
 * when it refuses to start a night run over a live batch.
 */
export function loadRegistryExclusions(projectId: string): {
  blockedEpicIds: Set<string>;
  projectBlocked: boolean;
} {
  const blockedEpicIds = new Set<string>();

  for (const run of listPipelineRunsByProject(projectId)) {
    if (isPipelineRunActive(run.state)) blockedEpicIds.add(run.epicId);
  }

  const night = nightRunRegistry.getActiveByProject(projectId);
  if (night) {
    for (const entry of night.epics) blockedEpicIds.add(entry.epicId);
  }

  for (const epicId of autoModeRegistry.mergingEpicIds(projectId)) blockedEpicIds.add(epicId);
  return {
    blockedEpicIds,
    projectBlocked: dagBatchRegistry.listByProject(projectId).length > 0,
  };
}

export interface EpicDispatchExclusions {
  projectBlocked: boolean;
  blockedEpicIds: ReadonlySet<string>;
  parkedTicketIds: ReadonlySet<string>;
  reviewRejectionsByEpic: ReadonlyMap<string, number>;
  busyEpicIds?: ReadonlySet<string>;
}

/** Same runtime holds for the execution queue and all Full Auto selectors. */
export function epicDispatchHold(facts: EpicDispatchExclusions, epicId: string): BuildQueueHold | null {
  if (facts.projectBlocked || facts.blockedEpicIds.has(epicId)) return "owned";
  if (facts.busyEpicIds?.has(epicId)) return "busy";
  if (facts.parkedTicketIds.has(epicId)) return "parked";
  if ((facts.reviewRejectionsByEpic.get(epicId) ?? 0) >= AUTO_MODE_MAX_REVIEW_REJECTIONS) return "review_rejections";
  return null;
}
