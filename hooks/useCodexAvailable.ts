"use client";

import { useEffect, useState } from "react";

/**
 * Checks if the Codex CLI is installed, authenticated, and ready to use.
 *
 * Returns:
 * - `codexAvailable`: true if installed AND logged in
 * - `codexInstalled`: true if installed (even if not logged in)
 * - `loading`: true while the check is in progress
 */
export function useCodexAvailable() {
  const [available, setAvailable] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/providers/available")
      .then((r) => r.json())
      .then((d) => {
        setAvailable(!!d.data?.codex);
        setInstalled(!!d.data?.codexInstalled);
      })
      .catch(() => {
        setAvailable(false);
        setInstalled(false);
      })
      .finally(() => setLoading(false));
  }, []);

  return { codexAvailable: available, codexInstalled: installed, loading };
}
