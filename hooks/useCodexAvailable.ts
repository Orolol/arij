"use client";

import { useEffect, useState } from "react";

/**
 * Checks if the Codex API key is configured in settings.
 * Returns true if the key is present and non-empty.
 */
export function useCodexAvailable() {
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        const key = d.data?.codex_api_key;
        setAvailable(!!key && typeof key === "string" && key.length > 0);
      })
      .catch(() => setAvailable(false))
      .finally(() => setLoading(false));
  }, []);

  return { codexAvailable: available, loading };
}
