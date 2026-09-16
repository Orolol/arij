"use client";

import { useTranslations } from "next-intl";
import { useState, useCallback } from "react";
import { fetchJson } from "@/lib/api/client";
import { usePolledResource } from "@/hooks/usePolledResource";
import { toAgentRequestError } from "@/lib/agents/client-error";
import type { UnifiedActivity } from "@/lib/agent-sessions/active-activity";

interface AgentActionResult { sessionId?: string; clean?: boolean; resolved?: boolean; merged?: boolean }

export type AgentDispatchTarget =
  | { kind: "epic"; epicId: string | null }
  | { kind: "story"; storyId: string; epicId?: string | null };

/**
 * Polls active agent sessions for an epic or story and exposes the
 * dispatch actions (build / review / approve, plus resolve-merge for
 * epic targets only).
 */
export function useAgentDispatch(projectId: string, target: AgentDispatchTarget) {
  const tErrors = useTranslations("ClientErrors");
  const kind = target.kind;
  const epicId = target.epicId ?? null;
  const storyId = kind === "story" ? target.storyId : null;

  // Base API path for the target entity. Null when an epic target has no
  // epic selected yet — every action is a no-op in that case.
  const targetPath =
    kind === "epic"
      ? epicId
        ? `/api/projects/${projectId}/epics/${epicId}`
        : null
      : `/api/projects/${projectId}/stories/${storyId}`;

  const [dispatching, setDispatching] = useState(false);
  const errorMessage = useCallback(() => tErrors("agentRequestFailed"), [tErrors]);
  const sessions = usePolledResource<UnifiedActivity[]>(targetPath ? `/api/projects/${projectId}/sessions/active` : null, 3000, errorMessage);
  const pollSessions = sessions.refresh;
  const activeSessions = (sessions.data ?? []).filter((session) =>
    (session.status === "running" || session.status === "queued") &&
    (kind === "epic" ? session.epicId === epicId : session.userStoryId === storyId || Boolean(epicId && session.epicId === epicId)));

  const postAgentRequest = useCallback(
    async (url: string, body: Record<string, unknown>) => {
      const response = await fetchJson<{ data?: AgentActionResult; error?: string }>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = response?.body ?? {};
      if (!response?.ok || data.error) throw toAgentRequestError(data, tErrors("agentRequestFailed"));
      return data.data;
    },
    [tErrors]
  );

  const sendToDev = useCallback(
    async (
      comment?: string,
      namedAgentId?: string | null,
      resumeSessionId?: string,
      pipeline?: boolean
    ) => {
      if (!targetPath) return;
      setDispatching(true);
      const build = async () => {
        const body: Record<string, unknown> = { comment, namedAgentId };
        if (resumeSessionId) body.resumeSessionId = resumeSessionId;
        // Only sent when the caller made an explicit choice — omitting the
        // field lets the server fall back to the pipeline_enabled setting.
        if (typeof pipeline === "boolean") body.pipeline = pipeline;
        const data = await postAgentRequest(`${targetPath}/build`, body);
        await pollSessions();
        return data;
      };
      // A `.finally` call, not a `finally` clause, here and below: the React
      // Compiler stops at the clause, and stopping left this hook unread by
      // every compiler rule. The rejection still reaches the caller.
      return build().finally(() => setDispatching(false));
    },
    [targetPath, postAgentRequest, pollSessions]
  );

  const sendToReview = useCallback(
    async (reviewTypes: string[], namedAgentId?: string | null, resumeSessionId?: string) => {
      if (!targetPath) return;
      setDispatching(true);
      const review = async () => {
        const body: Record<string, unknown> = { reviewTypes, namedAgentId };
        if (resumeSessionId) body.resumeSessionId = resumeSessionId;
        const data = await postAgentRequest(`${targetPath}/review`, body);
        await pollSessions();
        return data;
      };
      return review().finally(() => setDispatching(false));
    },
    [targetPath, postAgentRequest, pollSessions]
  );

  /** Epic targets only: grading is observational and never changes status. */
  const sendToGrading = useCallback(
    async (namedAgentId?: string | null) => {
      if (kind !== "epic" || !targetPath) return;
      setDispatching(true);
      const grade = async () => {
        const data = await postAgentRequest(`${targetPath}/grading`, {
          namedAgentId,
        });
        await pollSessions();
        return data;
      };
      return grade().finally(() => setDispatching(false));
    },
    [kind, targetPath, postAgentRequest, pollSessions],
  );

  /** Epic targets only — no-op for story targets. */
  const resolveMerge = useCallback(
    async (namedAgentId?: string | null, resumeSessionId?: string) => {
      if (kind !== "epic" || !targetPath) return;
      setDispatching(true);
      const resolve = async () => {
        const body: Record<string, unknown> = {};
        if (namedAgentId) body.namedAgentId = namedAgentId;
        if (resumeSessionId) body.resumeSessionId = resumeSessionId;
        const data = await postAgentRequest(`${targetPath}/resolve-merge`, body);
        await pollSessions();
        return data;
      };
      return resolve().finally(() => setDispatching(false));
    },
    [kind, targetPath, postAgentRequest, pollSessions]
  );

  /**
   * Merge the epic's branch — the merge IS the approval. Epic targets hit
   * POST .../merge; story targets keep the story approve route (a story has
   * no branch of its own).
   */
  const merge = useCallback(async () => {
    if (!targetPath) return;
    const endpoint =
      kind === "epic" ? `${targetPath}/merge` : `${targetPath}/approve`;
    const response = await fetchJson<{ data?: AgentActionResult; error?: string }>(endpoint, { method: "POST" });
    const data = response?.body ?? {};
    if (!response?.ok || data.error) throw toAgentRequestError(data, tErrors("agentRequestFailed"));
    return data.data;
  }, [kind, targetPath, tErrors]);

  const isRunning = activeSessions.length > 0;
  const activeSession = activeSessions[0] ?? null;

  return {
    activeSessions,
    activeSession,
    dispatching,
    isRunning,
    sendToDev,
    sendToReview,
    sendToGrading,
    resolveMerge,
    merge,
    refreshSessions: pollSessions,
  };
}
