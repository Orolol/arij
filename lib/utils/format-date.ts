/**
 * Shared date/time display helpers.
 *
 * For live "elapsed time" tickers (agent runtime counters), use
 * `lib/utils/format-elapsed.ts` instead.
 */

/** "Jan 5, 03:07 PM" — short month + day + 2-digit time. */
export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "1/5/2026 3:07:12 PM" — locale date + time, "-" for null, raw value if unparsable. */
export function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" — empty string for null. */
export function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const seconds = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
