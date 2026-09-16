import { agentMaxConcurrentSettingKey } from "@/lib/agents/scheduler-constants";
import { } from "@/lib/night/constants";
import {
  pipelineEnabledSettingKey,
  pipelineGraderEnabledSettingKey,
  pipelineMaxAttemptsSettingKey,
  pipelineMaxFixCyclesSettingKey,
} from "@/lib/pipeline/constants";
import { ciAutofixEnabledSettingKey } from "@/lib/routines/settings";
import {
  verifyCommandsSettingKey,
  verifyTimeoutMsSettingKey,
} from "@/lib/verify/verify-constants";
import { webhookSettingKey } from "@/lib/webhooks/send";
import {
  dreamingAfterNightRunSettingKey,
  dreamingLastCutoffSettingKey,
} from "@/lib/workflow/dreaming-constants";

/**
 * Every `<key>:<projectId>` settings row a project can own.
 *
 * The settings table is a flat key/value store with no foreign key to
 * `projects`, so deleting a project leaves these rows behind forever — and a
 * later project reusing the id would silently inherit them. Deletion sweeps
 * this list.
 *
 * Keep in sync when a new per-project settings key is introduced; the
 * corresponding test asserts the list matches every `…SettingKey(projectId)`
 * builder in the codebase.
 */
export function perProjectSettingKeys(projectId: string): string[] {
  return [
    agentMaxConcurrentSettingKey(projectId),
    webhookSettingKey(projectId),
    pipelineEnabledSettingKey(projectId),
    pipelineGraderEnabledSettingKey(projectId),
    pipelineMaxAttemptsSettingKey(projectId),
    pipelineMaxFixCyclesSettingKey(projectId),
    verifyCommandsSettingKey(projectId),
    verifyTimeoutMsSettingKey(projectId),
    dreamingAfterNightRunSettingKey(projectId),
    dreamingLastCutoffSettingKey(projectId),
    ciAutofixEnabledSettingKey(projectId),
  ];
}
