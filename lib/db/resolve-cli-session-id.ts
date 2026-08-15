/**
 * Resolves the canonical CLI session id for a row loaded from the database.
 *
 * Legacy-row fallback: rows written before the claudeSessionId -> cliSessionId
 * migration may only have the legacy `claude_session_id` column populated.
 * This helper is the single read-side fallback — apply it where rows are
 * loaded so that everything downstream deals exclusively with `cliSessionId`.
 */
export function resolveCliSessionId(row: {
  cliSessionId?: string | null;
  claudeSessionId?: string | null;
}): string | null {
  return row.cliSessionId ?? row.claudeSessionId ?? null;
}
