"use client";

import { useState, useCallback, useEffect, useRef } from "react";

interface BatchSelectionState {
  /** All selected ticket IDs (user-selected + auto-included) */
  allSelected: Set<string>;
  /** IDs explicitly selected by the user */
  userSelected: Set<string>;
  /** IDs auto-included as transitive prerequisites */
  autoIncluded: Set<string>;
}

export function useBatchSelection(projectId: string) {
  const [state, setState] = useState<BatchSelectionState>({
    allSelected: new Set(),
    userSelected: new Set(),
    autoIncluded: new Set(),
  });
  const [loading, setLoading] = useState(false);
  const fetchController = useRef<AbortController | null>(null);

  const resolveTransitive = useCallback(
    async (userIds: Set<string>) => {
      if (userIds.size === 0) {
        setState({
          allSelected: new Set(),
          userSelected: new Set(),
          autoIncluded: new Set(),
        });
        return;
      }

      // Cancel any in-flight request
      fetchController.current?.abort();
      const controller = new AbortController();
      fetchController.current = controller;

      setLoading(true);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/dependencies/transitive`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticketIds: Array.from(userIds) }),
            signal: controller.signal,
          }
        );

        if (!res.ok) {
          // Fallback: just use user selection
          setState({
            allSelected: new Set(userIds),
            userSelected: new Set(userIds),
            autoIncluded: new Set(),
          });
          return;
        }

        const json = await res.json();
        const all = new Set<string>(json.data.all);
        const auto = new Set<string>(json.data.autoIncluded);

        setState({
          allSelected: all,
          userSelected: new Set(userIds),
          autoIncluded: auto,
        });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        // Fallback: just use user selection
        setState({
          allSelected: new Set(userIds),
          userSelected: new Set(userIds),
          autoIncluded: new Set(),
        });
      } finally {
        setLoading(false);
      }
    },
    [projectId]
  );

  const toggle = useCallback(
    (epicId: string) => {
      setState((prev) => {
        const next = new Set(prev.userSelected);
        if (next.has(epicId)) {
          next.delete(epicId);
        } else {
          next.add(epicId);
        }
        // Trigger transitive resolution
        resolveTransitive(next);
        return { ...prev, userSelected: next };
      });
    },
    [resolveTransitive]
  );

  const clear = useCallback(() => {
    setState({
      allSelected: new Set(),
      userSelected: new Set(),
      autoIncluded: new Set(),
    });
  }, []);

  const isAutoIncluded = useCallback(
    (epicId: string) => state.autoIncluded.has(epicId),
    [state.autoIncluded]
  );

  const isUserSelected = useCallback(
    (epicId: string) => state.userSelected.has(epicId),
    [state.userSelected]
  );

  return {
    allSelected: state.allSelected,
    userSelected: state.userSelected,
    autoIncluded: state.autoIncluded,
    loading,
    toggle,
    clear,
    isAutoIncluded,
    isUserSelected,
  };
}
