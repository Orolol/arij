"use client";

import { useState, useEffect, useCallback } from "react";

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

export function useReviewComments(projectId: string, epicId: string | null) {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchComments = useCallback(async () => {
    if (!epicId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/epics/${epicId}/review-comments`
      );
      const data = await res.json();
      setComments(data.data || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [projectId, epicId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const addComment = useCallback(
    async (filePath: string, lineNumber: number, body: string) => {
      if (!epicId) return;
      const res = await fetch(
        `/api/projects/${projectId}/epics/${epicId}/review-comments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath, lineNumber, body }),
        }
      );
      const data = await res.json();
      if (data.data) {
        setComments((prev) => [...prev, data.data]);
      }
      return data.data;
    },
    [projectId, epicId]
  );

  const updateComment = useCallback(
    async (id: string, updates: { body?: string; status?: string }) => {
      if (!epicId) return;
      const res = await fetch(
        `/api/projects/${projectId}/epics/${epicId}/review-comments`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...updates }),
        }
      );
      const data = await res.json();
      if (data.data) {
        setComments((prev) =>
          prev.map((c) => (c.id === id ? data.data : c))
        );
      }
      return data.data;
    },
    [projectId, epicId]
  );

  const deleteComment = useCallback(
    async (id: string) => {
      if (!epicId) return;
      await fetch(
        `/api/projects/${projectId}/epics/${epicId}/review-comments`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        }
      );
      setComments((prev) => prev.filter((c) => c.id !== id));
    },
    [projectId, epicId]
  );

  const resolveAll = useCallback(async () => {
    if (!epicId) return;
    const openComments = comments.filter((c) => c.status === "open");
    for (const comment of openComments) {
      await updateComment(comment.id, { status: "resolved" });
    }
  }, [epicId, comments, updateComment]);

  const openCount = comments.filter((c) => c.status === "open").length;

  return {
    comments,
    loading,
    openCount,
    addComment,
    updateComment,
    deleteComment,
    resolveAll,
    refresh: fetchComments,
  };
}
