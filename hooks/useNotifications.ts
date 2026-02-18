"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface NotificationItem {
  id: string;
  projectId: string;
  projectName: string;
  sessionId: string | null;
  agentType: string | null;
  status: string; // completed | failed
  title: string;
  targetUrl: string;
  createdAt: string | null;
}

interface NotificationsState {
  notifications: NotificationItem[];
  unreadCount: number;
  loading: boolean;
}

const POLL_INTERVAL_MS = 5000;
const BASE_TITLE = "Arij";

export function useNotifications() {
  const [state, setState] = useState<NotificationsState>({
    notifications: [],
    unreadCount: 0,
    loading: true,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=50");
      if (!res.ok) return;
      const body = await res.json();
      setState({
        notifications: body.data || [],
        unreadCount: body.unreadCount ?? 0,
        loading: false,
      });
    } catch {
      // Silently ignore — polling will retry
    }
  }, []);

  const markAsRead = useCallback(async () => {
    try {
      await fetch("/api/notifications/read", { method: "POST" });
      setState((prev) => ({ ...prev, unreadCount: 0 }));
    } catch {
      // Silently ignore
    }
  }, []);

  // Poll on interval
  useEffect(() => {
    fetchNotifications();
    intervalRef.current = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchNotifications]);

  // Update document.title reactively
  useEffect(() => {
    if (state.unreadCount > 0) {
      document.title = `(${state.unreadCount}) ${BASE_TITLE}`;
    } else {
      document.title = BASE_TITLE;
    }
  }, [state.unreadCount]);

  return {
    notifications: state.notifications,
    unreadCount: state.unreadCount,
    loading: state.loading,
    markAsRead,
    refresh: fetchNotifications,
  };
}
