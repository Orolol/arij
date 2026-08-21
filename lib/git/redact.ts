/**
 * Credential redaction for git output.
 *
 * The clone service passes the GitHub PAT to git as an `http.extraHeader`
 * config value on the command line. git echoes the failing command back in its
 * stderr, so the raw error text can contain the base64-encoded token — and that
 * text is exactly what we would otherwise return to the UI and write into
 * `git_sync_log`. Every string that crosses either boundary goes through
 * `redactGitCredentials` first.
 */

const REDACTED = "[redacted]";

const PATTERNS: Array<[RegExp, string]> = [
  // `Authorization: Basic <base64>` / `Authorization: Bearer <token>`, with or
  // without the surrounding `http.extraHeader=` and quoting.
  [/(authorization:\s*(?:basic|bearer|token)\s+)\S+/gi, `$1${REDACTED}`],
  // Credentials embedded in a URL: https://user:pass@host, ssh://git:tok@host.
  [/:\/\/[^/\s:@]+:[^/\s@]*@/g, `://${REDACTED}@`],
  // …and the userinfo-only form https://token@github.com.
  [/:\/\/(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)@/g, `://${REDACTED}@`],
  // Bare GitHub tokens anywhere in the text (logs, JSON payloads, prose).
  [/\bghp_[A-Za-z0-9]{16,}\b/g, REDACTED],
  [/\bgh[ousr]_[A-Za-z0-9]{16,}\b/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
];

/** Returns `text` with every recognisable credential replaced. */
export function redactGitCredentials(text: string): string {
  if (!text) return text;

  let output = text;
  for (const [pattern, replacement] of PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/**
 * Redacts the message of an unknown thrown value and returns it as a plain
 * string, so route handlers can surface a git failure without leaking the PAT.
 */
export function redactedErrorMessage(error: unknown, fallback = "Unknown error"): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return redactGitCredentials(message || fallback);
}
