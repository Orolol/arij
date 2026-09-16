"use client";

import { useMemo } from "react";

import { usePolledResource } from "@/hooks/usePolledResource";

import {
  AUTO_MODE_ENABLED_SETTING_KEY,
  autoModeEnabledSettingKey,
  parseAutoModeEnabled,
} from "@/lib/auto-mode/constants";

/**
 * Which projects have Full Auto armed — read from the settings the supervisor
 * itself reads.
 *
 * THERE IS NO GLOBAL FULL AUTO FLAG. `auto_mode_enabled` is a per-project
 * override (`auto_mode_enabled:<projectId>`) falling back to a global default,
 * exactly as `app/api/control-desk/route.ts` resolves it. The top bar's "Auto"
 * pill is turquoise when ANY project is armed, so it needs the same chain.
 *
 * ONE READ, NO POLL. `GET /api/settings` is a scan of a small key/value table;
 * the bar calls `refresh()` when the route changes and never on a timer. The
 * desk keeps its own per-project switches (it already holds the control-desk
 * payload) — this hook exists so the bar does not have to poll that much
 * heavier aggregate on every route just to colour one pill.
 *
 * `loaded` is false until the first response lands, and the pill stays neutral
 * until then: a pill that flashes turquoise and then goes out would be a
 * colour claiming a state it did not know.
 */
export interface AutoModeArmedState {
  /** Per-project overrides, absent key = "not configured". */
  armed: ReadonlyMap<string, boolean>;
  /** The global default an unconfigured project falls through to. */
  globalDefault: boolean;
  loaded: boolean;
  refresh: () => Promise<void>;
}

const statusError = () => "Unable to load Full Auto configuration";

export function useAutoModeArmed(): AutoModeArmedState {
  const { data, refresh } = usePolledResource<Record<string, unknown>>("/api/settings", null, statusError);
  const armed = useMemo(() => {
    const next = new Map<string, boolean>();
    const prefix = `${AUTO_MODE_ENABLED_SETTING_KEY}:`;
    for (const [key, value] of Object.entries(data ?? {})) {
      if (!key.startsWith(prefix)) continue;
      const parsed = parseAutoModeEnabled(value);
      if (parsed !== null) next.set(key.slice(prefix.length), parsed);
    }
    return next;
  }, [data]);
  return { armed, globalDefault: parseAutoModeEnabled(data?.[AUTO_MODE_ENABLED_SETTING_KEY]) ?? false, loaded: data !== null, refresh };
}

/** The resolved switch for one project: override, else the global default. */
export function isProjectArmed(
  state: Pick<AutoModeArmedState, "armed" | "globalDefault">,
  projectId: string,
): boolean {
  const override = state.armed.get(projectId);
  return override ?? state.globalDefault;
}

/** Re-exported so a caller can build the same key without a second import. */
export { autoModeEnabledSettingKey };
