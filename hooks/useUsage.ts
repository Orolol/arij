"use client";

import { useCallback, useEffect, useState } from "react";
import type { UsageReport } from "@/lib/types/usage";

/**
 * The usage observatory's single data source: one fat GET /api/usage.
 *
 * Deliberately NOT polled. Subscription burn is slow state, not live
 * activity — a manual refresh button is the contract, so the page never
 * churns the codex rollout scan the route performs on every read.
 *
 * A failed refresh keeps the previously loaded report on screen and only
 * raises `error`; the page decides whether that means "error screen" (no
 * report yet) or "stale data plus a warning".
 */
export function useUsage() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/usage");
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          typeof body?.error === "string"
            ? body.error
            : "Failed to load the usage report."
        );
        return;
      }
      if (!body?.data) {
        setError("Failed to load the usage report.");
        return;
      }
      setReport(body.data as UsageReport);
    } catch {
      setError("Failed to load the usage report.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { report, loading, error, refresh };
}
