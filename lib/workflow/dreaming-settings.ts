/**
 * Settings rows the memory writers read and write: the dream cutoff and the
 * "dream after a night run" switch.
 *
 * Kept apart from dreaming.ts so the callers that only need an ANSWER (the
 * distill's night-run stand-down, the restore route) do not load the whole
 * dispatch path — prompt builder, scheduler, event bus — to get it.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { parseTimestampMs } from "./dreaming-digest";
import {
  DREAMING_AFTER_NIGHT_RUN_SETTING_KEY,
  dreamingLastCutoffSettingKey,
  parseDreamingAfterNightRunSetting,
} from "./dreaming-constants";

/**
 * The raw stored value of one settings row, or null when the row does not
 * exist (or the table is unreadable — a setting read must never throw into a
 * workflow that only wanted a default).
 */
export function readSettingValue(key: string): string | null {
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
 * Where the project's next dream window opens: the collection cutoff of the
 * last dream that actually REPLACED the memory document.
 *
 * Read from a settings row rather than derived from dream sessions on purpose.
 * A session row can only say "this dream finished and answered", which is a
 * strictly worse question on two counts: it moves the window past sessions
 * that ended while the dream was running, and it counts a dream whose memory
 * write threw as if it had landed. The cutoff row is written at exactly one
 * place — after a successful save — and cleared when the pre-dream snapshot is
 * restored, so its presence means the evidence up to that instant really is
 * inside the stored memory.
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
 *
 * One upsert statement rather than select-then-write: the cutoff is written
 * from a session's terminal closure while a restore can clear it from a
 * request handler, and a two-step upsert has a gap between its two steps.
 */
export function recordDreamCutoff(projectId: string, cutoffIso: string): void {
  const key = dreamingLastCutoffSettingKey(projectId);
  const value = JSON.stringify(cutoffIso);
  const updatedAt = new Date().toISOString();
  db.insert(settings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
    .run();
}

/**
 * Forgets the cutoff, reopening the window to the age/count floor.
 *
 * The one caller is the pre-dream snapshot restore. The cutoff's contract is
 * "the evidence up to this instant is inside the stored memory"; the moment
 * the memory goes back to the text from BEFORE the dream, that stops being
 * true for every session the dream digested, and leaving the cutoff in place
 * would mark them learned without anything having learned them. Re-reading a
 * few older sessions is the harmless direction; skipping the dream's forever
 * is not.
 */
export function clearDreamCutoff(projectId: string): void {
  db.delete(settings)
    .where(eq(settings.key, dreamingLastCutoffSettingKey(projectId)))
    .run();
}

/**
 * Whether a finished night run dreams: the global switch, OFF when absent.
 *
 * Global only. A per-project `dreaming_after_night_run:<id>` override used to
 * be resolved ahead of this key, but nothing ever wrote it — no settings
 * field, no dialog, no route — so it was a contract with no author. One key,
 * written by the one toggle the settings screen has.
 */
export function isDreamingAfterNightRunEnabled(): boolean {
  return (
    parseDreamingAfterNightRunSetting(
      readSettingValue(DREAMING_AFTER_NIGHT_RUN_SETTING_KEY)
    ) ?? false
  );
}
