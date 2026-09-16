"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface BatchSelectionState {
  /** All selected ticket IDs (user-selected + auto-included) */
  allSelected: Set<string>;
  /** IDs explicitly selected by the user */
  userSelected: Set<string>;
  /** IDs auto-included as transitive prerequisites */
  autoIncluded: Set<string>;
  /** Ordered IDs selected by the user (oldest-first) */
  selectedTicketIds: string[];
}

function createEmptySelectionState(): BatchSelectionState {
  return {
    allSelected: new Set(),
    userSelected: new Set(),
    autoIncluded: new Set(),
    selectedTicketIds: [],
  };
}

function normalizeTicketIds(ticketIds: Iterable<string>) {
  return Array.from(new Set(ticketIds));
}

export function useBatchSelection(projectId: string) {
  const [state, setState] = useState<BatchSelectionState>(createEmptySelectionState);
  const [loading, setLoading] = useState(false);
  const fetchController = useRef<AbortController | null>(null);

  const [selectionProjectId, setSelectionProjectId] = useState(projectId);
  if (selectionProjectId !== projectId) {
    setSelectionProjectId(projectId);
    setState(createEmptySelectionState());
    setLoading(false);
  }

  useEffect(() => () => { fetchController.current?.abort(); }, [projectId]);

  const resolveTransitive = useCallback(async (selectedTicketIds: string[]) => {
    fetchController.current?.abort();
    const controller = new AbortController();
    fetchController.current = controller;
    setLoading(true);

    const userSelected = new Set(selectedTicketIds);
    let allSelected = new Set(userSelected);
    let autoIncluded = new Set<string>();
    const res = await fetch(`/api/projects/${projectId}/dependencies/transitive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketIds: selectedTicketIds }),
      signal: controller.signal,
    }).catch(() => null);
    const json = res?.ok ? await res.json().catch(() => null) : null;
    if (json?.data) {
      allSelected = new Set([...userSelected, ...(json.data.all ?? [])]);
      autoIncluded = new Set((json.data.autoIncluded ?? []).filter(
        (id: string) => !userSelected.has(id),
      ));
    }
    // Identity, not matching IDs: A → B → A must not revive A's first request.
    if (controller.signal.aborted || fetchController.current !== controller) return;
    setState({ allSelected, userSelected, autoIncluded, selectedTicketIds });
    setLoading(false);
  }, [projectId]);

  const setSelectedTicketIds = useCallback(
    (ticketIds: string[]) => {
      const normalizedIds = normalizeTicketIds(ticketIds);

      if (normalizedIds.length === 0) {
        fetchController.current?.abort();
        setLoading(false);
        setState(createEmptySelectionState());
        return;
      }

      const userSelected = new Set(normalizedIds);
      setState((prev) => ({
        ...prev,
        allSelected: new Set(userSelected),
        userSelected: new Set(userSelected),
        autoIncluded: new Set(),
        selectedTicketIds: normalizedIds,
      }));

      void resolveTransitive(normalizedIds);
    },
    [resolveTransitive]
  );

  const selectPrimary = useCallback(
    (epicId: string) => {
      setSelectedTicketIds([epicId]);
    },
    [setSelectedTicketIds]
  );

  const toggle = useCallback(
    (epicId: string) => {
      const nextTicketIds = state.selectedTicketIds.includes(epicId)
        ? state.selectedTicketIds.filter((id) => id !== epicId)
        : [...state.selectedTicketIds, epicId];

      setSelectedTicketIds(nextTicketIds);
    },
    [setSelectedTicketIds, state.selectedTicketIds]
  );

  const clear = useCallback(() => {
    fetchController.current?.abort();
    setLoading(false);
    setState(createEmptySelectionState());
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
    selectedTicketIds: state.selectedTicketIds,
    loading,
    selectPrimary,
    toggle,
    setSelectedTicketIds,
    clear,
    isAutoIncluded,
    isUserSelected,
  };
}
