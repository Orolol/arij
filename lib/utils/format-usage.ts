/**
 * Formatting helpers for session token/cost usage surfaces.
 *
 * Both helpers return `null` for absent values so callers can decide the
 * placeholder (em-dash in tables, hidden line in headers) instead of ever
 * rendering a fake "$0.00".
 */

/**
 * Formats a USD cost: "$1.24", "$0.084", "$0.0007".
 * More precision at small magnitudes — agent runs routinely cost cents.
 */
export function formatCostUsd(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 3 : 4;
  return `$${value.toFixed(digits)}`;
}

/**
 * Formats a token count compactly: 830 -> "830", 12480 -> "12.5k",
 * 3400000 -> "3.4M".
 */
export function formatTokens(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}
