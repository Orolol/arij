"use client";

import { useTranslations } from "next-intl";

import { useCallback } from "react";
import { usePolledResource } from "@/hooks/usePolledResource";
import { requestJson } from "@/lib/api/client";
const loadError = () => "Unable to load ticket comments";
const isComments = (value: unknown): value is TicketComment[] => Array.isArray(value);

export interface TicketComment {
  id: string;
  userStoryId?: string | null;
  epicId?: string | null;
  author: "user" | "agent";
  content: string;
  agentSessionId: string | null;
  createdAt: string;
}

const EMPTY_COMMENTS: TicketComment[] = [];

export type TicketCommentsTarget =
  | { kind: "epic"; epicId: string | null }
  | { kind: "story"; storyId: string };

/**
 * Loads and polls (5s) the comment thread of an epic or story.
 * Epic targets with a null epicId — and any target on an unresolved project —
 * resolve to an empty, non-polling thread.
 */
export function useTicketComments(
  projectId: string | null | undefined,
  target: TicketCommentsTarget,
) {
  const tErrors = useTranslations("ClientErrors");
  const kind = target.kind;
  const epicId = kind === "epic" ? target.epicId : null;
  const storyId = kind === "story" ? target.storyId : null;

  // An unresolved project is not an id: `/api/projects//stories/s1/comments`
  // collapses to `/api/projects/stories/s1/comments`, a route nothing serves.
  // The epic branch below guards `epicId`, which says nothing about the
  // project, so the project needs its own guard — before the request, and on
  // both branches, since this thread polls every 5 seconds.
  const resolvedProjectId = projectId?.trim() ? projectId.trim() : null;

  const commentsUrl = !resolvedProjectId
    ? null
    : kind === "epic"
      ? epicId
        ? `/api/projects/${resolvedProjectId}/epics/${epicId}/comments`
        : null
      : `/api/projects/${resolvedProjectId}/stories/${storyId}/comments`;

  const { data, loading, error, refresh, updateData } = usePolledResource<TicketComment[]>(commentsUrl, 5000, loadError, { validateData: isComments });
  const addComment = useCallback(async (content: string) => {
    if (!commentsUrl) return;
    const result = await requestJson<TicketComment>(commentsUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: "user", content }), errorMessage: tErrors("failedToAddComment") });
    if (result.error !== null) throw new Error(result.error);
    updateData((previous) => [...(previous ?? []), result.data]);
    return result.data;
  }, [commentsUrl, tErrors, updateData]);
  return { comments: data ?? EMPTY_COMMENTS, loading, error, addComment, refresh };
}
