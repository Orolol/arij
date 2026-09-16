/**
 * Format elapsed time from a start date to a human-readable string.
 *
 * - Under 60s: "Xs"
 * - Under 60m: "Xm Ys"
 * - Over 60m: "Xh Ym"
 */
export function formatElapsed(startedAt: string | Date, now?: Date): string {
  const start =
    typeof startedAt === "string" ? new Date(startedAt) : startedAt;
  const current = now ?? new Date();
  const totalSeconds = Math.max(
    0,
    Math.floor((current.getTime() - start.getTime()) / 1000),
  );

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);

  if (totalMinutes < 60) {
    const secs = totalSeconds % 60;
    return `${totalMinutes}m ${secs}s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}h ${mins}m`;
}

/**
 * The compact elapsed glyph every frame draws: "4m12", not "4m 12s".
 *
 * `formatElapsed` stays the arithmetic; this is its presentation for the
 * frames (5a, 6a, 6c, 7a, 8a all render "4m12"). The seconds are zero-padded
 * so "1m 3s" → "1m 12s" does not change the glyph COUNT — un-padded, the
 * numeral jitters even with tabular figures. Anything that does not match a
 * known shape passes through untouched.
 *
 * Shared rather than duplicated: `Chrono` applies it while ticking, and the
 * ended-session header applies it once — mounting `Chrono` for a session that
 * has ended would start a 1s ticker counting past the end.
 */
export function compactElapsed(elapsed: string): string {
  const match = /^(\d+)([mh])\s(\d+)[ms]$/.exec(elapsed);
  if (!match) return elapsed; // "47s", and any future shape
  return `${match[1]}${match[2]}${match[3].padStart(2, "0")}`;
}
