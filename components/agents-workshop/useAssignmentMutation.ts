"use client";
import { useTranslations } from "next-intl";
import { useScopedMutation } from "@/hooks/useScopedMutation";
import type { AgentType } from "@/lib/agent-config/constants";
export function useAssignmentMutation(scopeKey: string, assign: (role: AgentType, agentId: string | null) => Promise<{ ok: boolean; error?: string }>) {
  const t = useTranslations("AgentsWorkshop");
  const mutation = useScopedMutation(scopeKey);
  async function updateAssignment(role: AgentType, agentId: string | null) {
    await mutation.run(async () => {
      const result = await assign(role, agentId);
      if (!result.ok) throw new Error(result.error || t("assignments.updateFailed"));
      return true;
    }, t("assignments.updateFailedRetry"), role);
  }
  return { savingRoles: mutation.pendingKeys as AgentType[], errors: mutation.errors, updateAssignment };
}
