/**
 * THE timestamp normaliser — the one place that knows the two UTC shapes Arij
 * stores: explicit ISO strings and SQLite CURRENT_TIMESTAMP values, including
 * legacy `T` separators and second-less `HH:MM` forms. The stored value has no
 * zone marker, and `Date.parse` would read it as local time, so its UTC origin
 * is made explicit first.
 *
 * Dependency-free on purpose: the interface (`lib/i18n/format.ts`), the server
 * read-models and the telescope collector all funnel through here.
 */

const ZONELESS_TIMESTAMP_RE =
  /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

export function parseStoredTimestamp(value: string): number | null {
  const trimmed = value.trim();
  const sqliteMatch = trimmed.match(ZONELESS_TIMESTAMP_RE);
  const normalized = sqliteMatch
    ? `${sqliteMatch[1]}T${sqliteMatch[2]}Z`
    : trimmed;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Chronological display order; absent and invalid timestamps stay last in either direction. */
export function compareStoredTimestamps(
  a: string | null | undefined,
  b: string | null | undefined,
  direction: "asc" | "desc" = "asc",
): number {
  const aAt = a ? parseStoredTimestamp(a) : null;
  const bAt = b ? parseStoredTimestamp(b) : null;
  if (aAt === bAt) return 0;
  if (aAt === null) return 1;
  if (bAt === null) return -1;
  return (aAt - bAt) * (direction === "desc" ? -1 : 1);
}

/**
 * Return the newest valid activity timestamp in a stable ISO representation.
 * Invalid legacy values are ignored instead of making the whole session
 * unsortable.
 */
export function latestActivityTimestamp(
  ...values: Array<string | null | undefined>
): string | null {
  let latestMs: number | null = null;

  for (const value of values) {
    if (!value) continue;
    const parsed = parseStoredTimestamp(value);
    if (parsed === null) continue;
    if (latestMs === null || parsed > latestMs) latestMs = parsed;
  }

  return latestMs === null ? null : new Date(latestMs).toISOString();
}
