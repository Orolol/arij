/** Persisted cutoffs advance only after a successful guarded memory write. */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { parseTimestampMs } from "./dreaming-digest";
import {
  DREAMING_AFTER_NIGHT_RUN_SETTING_KEY,
  dreamingAfterNightRunSettingKey,
  dreamingLastCutoffSettingKey,
  parseDreamingAfterNightRunSetting,
} from "./dreaming-constants";

/**
 * Where the project's next dream window opens: the collection cutoff of the
 * last dream that actually REPLACED the memory document.
 *
 * Read from a settings row rather than derived from dream sessions on purpose.
 * A session row can only say "this dream finished and answered", which is a
 * strictly worse question on two counts: it moves the window past sessions
 * that ended while the dream was running, and it counts a dream whose memory
 * write threw as if it had landed. The cutoff row is written at exactly one
 * place — after a successful save — so its presence means the evidence up to
 * that instant really is inside the stored memory.
 */
export function findLastDreamCutoff(projectId: string): string | null {
  const raw = readSettingValue(dreamingLastCutoffSettingKey(projectId));
  if (!raw) return null;
  // The settings PATCH route JSON-encodes values; a hand-written row may be
  // raw. Accept both, reject anything undateable.
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    // raw (non-JSON) string — use as-is
  }
  if (typeof value !== "string") return null;
  return parseTimestampMs(value) === null ? null : value;
}

/**
 * Persists the collection cutoff. Called ONLY after the dreamed memory was
 * successfully stored — see the guard rails in `dispatchDreamingSession`.
 */
export function recordDreamCutoff(projectId: string, cutoffIso: string): void {
  const key = dreamingLastCutoffSettingKey(projectId);
  const value = JSON.stringify(cutoffIso);
  const now = new Date().toISOString();
  const existing = db
    .select({ key: settings.key })
    .from(settings)
    .where(eq(settings.key, key))
    .get();
  if (existing) {
    db.update(settings)
      .set({ value, updatedAt: now })
      .where(eq(settings.key, key))
      .run();
    return;
  }
  db.insert(settings).values({ key, value, updatedAt: now }).run();
}

function readSettingValue(key: string): string | null {
  try {
    return (
      db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, key))
        .get()?.value ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Effective "dream after a night run" answer: project key → global key → OFF.
 * Tri-state parsing all the way down, so an explicit per-project `false`
 * overrides a global `true`.
 */
export function isDreamingAfterNightRunEnabled(projectId: string): boolean {
  for (const key of [
    dreamingAfterNightRunSettingKey(projectId),
    DREAMING_AFTER_NIGHT_RUN_SETTING_KEY,
  ]) {
    const parsed = parseDreamingAfterNightRunSetting(readSettingValue(key));
    if (parsed !== null) return parsed;
  }
  return false;
}

