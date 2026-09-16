"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { requestJson } from "@/lib/api/client";
import { usePolledResource } from "@/hooks/usePolledResource";
import { useScopedMutation } from "@/hooks/useScopedMutation";

export interface ReviewComment {
  id: string;
  epicId: string;
  filePath: string;
  lineNumber: number;
  body: string;
  author: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

const NO_COMMENTS: ReviewComment[] = [];
function isComment(value: unknown): value is ReviewComment {
  if (!value || typeof value !== "object") return false;
  const comment = value as ReviewComment;
  return typeof comment.id === "string" && typeof comment.filePath === "string"
    && typeof comment.body === "string" && typeof comment.status === "string";
}
const isComments = (value: unknown): value is ReviewComment[] => Array.isArray(value) && value.every(isComment);
const isDeleted = (value: unknown): value is { deleted: true } =>
  Boolean(value && typeof value === "object" && "deleted" in value && value.deleted === true);

export function useReviewComments(projectId: string, epicId: string | null) {
  const t = useTranslations("Review");
  const url = epicId ? `/api/projects/${projectId}/epics/${epicId}/review-comments` : null;
  const errorMessage = useCallback(() => t("errors.loadComments"), [t]);
  const { data, loading, error: loadError, refresh: reload, updateData } = usePolledResource<ReviewComment[]>(
    url, null, errorMessage, { validateData: isComments },
  );
  const { run, pending, error: mutationError, clearError } = useScopedMutation(url);
  const comments = data ?? NO_COMMENTS;

  const saveComment = useCallback(async (method: "POST" | "PATCH", body: object) => {
    if (!url || !data) return null;
    return run(async () => {
      const response = await requestJson<ReviewComment>(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        errorMessage: t("errors.saveComment"), validateData: isComment,
      });
      if (response.error !== null) throw new Error(response.error);
      const saved = response.data;
      updateData((current) => method === "POST"
        ? [...(current ?? []).filter((comment) => comment.id !== saved.id), saved]
        : (current ?? []).map((comment) => comment.id === saved.id ? saved : comment));
      return saved;
    }, t("errors.saveComment"));
  }, [url, data, run, updateData, t]);

  const addComment = useCallback((filePath: string, lineNumber: number, body: string) =>
    saveComment("POST", { filePath, lineNumber, body }), [saveComment]);
  const updateComment = useCallback((id: string, updates: { body?: string; status?: string }) =>
    saveComment("PATCH", { id, ...updates }), [saveComment]);

  const deleteComment = useCallback(async (id: string) => {
    if (!url || !data) return false;
    return Boolean(await run(async () => {
      const response = await requestJson<{ deleted: true }>(url, {
        method: "DELETE", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }), errorMessage: t("errors.deleteComment"), validateData: isDeleted,
      });
      if (response.error !== null) throw new Error(response.error);
      updateData((current) => (current ?? []).filter((comment) => comment.id !== id));
      return true;
    }, t("errors.deleteComment")));
  }, [url, data, run, updateData, t]);

  const resolveAll = useCallback(async () => {
    if (!url || !data) return false;
    return Boolean(await run(async () => {
      const response = await requestJson<{ resolved: number }>(`${url}/resolve-all`, {
        method: "POST",
        errorMessage: t("errors.saveComment"),
        validateData: (value): value is { resolved: number } =>
          Boolean(value && typeof value === "object" && "resolved" in value && typeof (value as { resolved: unknown }).resolved === "number"),
      });
      if (response.error !== null) throw new Error(response.error);
      updateData((current) =>
        (current ?? []).map((row) =>
          row.status === "open" ? { ...row, status: "resolved" } : row
        )
      );
      return true;
    }, t("errors.saveComment")));
  }, [url, data, run, updateData, t]);

  const refresh = useCallback(async () => {
    clearError();
    await reload();
  }, [clearError, reload]);

  return {
    comments, loading, pending, ready: data !== null,
    error: mutationError ?? loadError,
    openCount: comments.filter((comment) => comment.status === "open").length,
    addComment, updateComment, deleteComment, resolveAll, refresh,
  };
}
