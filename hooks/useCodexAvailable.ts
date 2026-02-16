"use client";

import { useEffect, useState } from "react";
import type { AgentProvider } from "@/lib/agent-config/constants";

/**
 * Checks if the Codex CLI is installed, authenticated, and ready to use.
 *
 * Returns:
 * - `codexAvailable`: true if installed AND logged in
 * - `codexInstalled`: true if installed (even if not logged in)
 * - `loading`: true while the check is in progress
 */
export function useCodexAvailable() {
  const { codexAvailable, codexInstalled, loading } = useProvidersAvailable();
  return { codexAvailable, codexInstalled, loading };
}

export interface ProvidersAvailability {
  codexAvailable: boolean;
  codexInstalled: boolean;
  geminiAvailable: boolean;
  geminiInstalled: boolean;
  /** Per-provider availability map for all 9 providers. */
  providers: Record<AgentProvider, boolean>;
  loading: boolean;
}

const DEFAULT_PROVIDERS: Record<AgentProvider, boolean> = {
  "claude-code": false,
  codex: false,
  "gemini-cli": false,
  "mistral-vibe": false,
  "qwen-code": false,
  opencode: false,
  deepseek: false,
  kimi: false,
  zai: false,
};

/**
 * Checks availability of all CLI providers.
 */
export function useProvidersAvailable(): ProvidersAvailability {
  const [state, setState] = useState<Omit<ProvidersAvailability, "loading">>({
    codexAvailable: false,
    codexInstalled: false,
    geminiAvailable: false,
    geminiInstalled: false,
    providers: { ...DEFAULT_PROVIDERS },
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/providers/available")
      .then((r) => r.json())
      .then((d) => {
        const data = d.data ?? {};
        setState({
          codexAvailable: !!data.codex,
          codexInstalled: !!data.codexInstalled,
          geminiAvailable: !!data["gemini-cli"],
          geminiInstalled: !!data.geminiInstalled,
          providers: {
            "claude-code": !!data["claude-code"],
            codex: !!data.codex,
            "gemini-cli": !!data["gemini-cli"],
            "mistral-vibe": !!data["mistral-vibe"],
            "qwen-code": !!data["qwen-code"],
            opencode: !!data.opencode,
            deepseek: !!data.deepseek,
            kimi: !!data.kimi,
            zai: !!data.zai,
          },
        });
      })
      .catch(() => {
        setState({
          codexAvailable: false,
          codexInstalled: false,
          geminiAvailable: false,
          geminiInstalled: false,
          providers: { ...DEFAULT_PROVIDERS },
        });
      })
      .finally(() => setLoading(false));
  }, []);

  return { ...state, loading };
}
