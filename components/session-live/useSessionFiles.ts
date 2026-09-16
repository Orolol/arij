"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

import { useSessionPolling } from "./useSessionPolling";

import type {
  SessionDiff,
  SessionFilesProject,
  SessionFilesResponse,
  SessionFilesTicket,
} from "./types";

/**
 * The session's ticket, project and worktree diffstat, from the read-only
 * `/files` route.
 *
 * POLLED AT 15 SECONDS, NOT 3. The route shells out to git — `merge-base`,
 * `rev-list` and three `diff --numstat` calls in the session's worktree — and
 * `hooks/useWorktrees.ts` records the precedent: its route is "deliberately
 * not polled" for the same reason. 15s is the compromise this screen's
 * liveness needs; it is not folded into the 3-second session poll, and it is
 * not lowered.
 *
 * A failed request keeps the previous value and records the error: the header
 * identity, once it has landed, must not blink out because a git call failed.
 */

export interface SessionFilesState {
  ticket: SessionFilesTicket | null;
  project: SessionFilesProject | null;
  diff: SessionDiff | null;
  loading: boolean;
  error: string | null;
}

export function useSessionFiles(
  projectId: string,
  sessionId: string,
  isRunning: boolean
): SessionFilesState {
  // Read into a plain string so `load` depends on the message rather than on
  // the translator identity, which changes on every render.
  const t = useTranslations("SessionLive");
  const readFailedCopy = t("files.readFailed");
  const key = JSON.stringify([projectId, sessionId]);
  const [state, setState] = useState<(SessionFilesState & { key: string }) | null>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    let data: SessionFilesResponse | null = null;
    try {
      const res = await fetch(
        `/api/projects/${projectId}/sessions/${sessionId}/files`,
        { signal },
      );
      if (res.ok) {
        const body = (await res.json()) as { data: SessionFilesResponse | null };
        data = body.data;
      }
    } catch {
      // Never throws: this is ambient detail on a page that must keep working.
    }
    if (signal.aborted) return;
    if (data) {
      setState({ ...data, key, loading: false, error: null });
    } else {
      setState((previous) => ({
        ticket: previous?.key === key ? previous.ticket : null,
        project: previous?.key === key ? previous.project : null,
        diff: previous?.key === key ? previous.diff : null,
        key, loading: false, error: readFailedCopy,
      }));
    }
  }, [projectId, sessionId, key, readFailedCopy]);

  useSessionPolling(key, load, isRunning, 15000, { immediate: true });

  return state?.key === key ? state : { ticket: null, project: null, diff: null, loading: true, error: null };
}
