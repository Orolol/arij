/**
 * The credential that guards `/api/*` when Arij is deliberately listening
 * somewhere other than loopback.
 *
 * WHY A CREDENTIAL AND NOT A BETTER HOST CHECK. `proxy.ts` is handed a
 * request, never a socket, so the peer address is not available to it at any
 * price. Every "is this local?" answer it can compute comes from headers the
 * caller writes — `curl -H 'Host: localhost' http://<lan-ip>:3000/api/...`
 * satisfied the old check completely. Browsers were never the exposure (the
 * Origin check holds them); non-browser clients on the LAN were.
 *
 * So the default is not to listen there at all (`bin/launch-plan.mjs` binds
 * 127.0.0.1), and the opt-in carries a secret instead of a claim.
 *
 * RUNTIME-AGNOSTIC ON PURPOSE. `proxy.ts` may be evaluated in the edge
 * runtime, so nothing here imports `node:*`: the comparison is hand-written
 * rather than `crypto.timingSafeEqual`, and `process.env` is read lazily (the
 * same way `ALLOWED_ORIGINS` already was) so a test can restub it.
 */

/** Env var holding the per-boot credential. Set ⇒ remote mode is on. */
export const REMOTE_TOKEN_ENV_VAR = "ARIJ_REMOTE_TOKEN";

/**
 * Cookie the bootstrap route sets, and the reason the credential is a cookie
 * at all: `fetch`, `EventSource` and multipart uploads all carry it
 * same-origin without a single call site being aware it exists.
 */
export const REMOTE_TOKEN_COOKIE = "arij_remote_token";

/** Header a scripted client may use instead of the cookie. */
export const REMOTE_TOKEN_HEADER = "x-arij-remote-token";

/** Query parameter the one-time bootstrap URL carries. */
export const REMOTE_TOKEN_QUERY_PARAM = "token";

/**
 * The one `/api/*` path exempt from the credential check, because it IS the
 * credential check: it validates the token itself and trades it for a cookie.
 */
export const REMOTE_AUTH_BOOTSTRAP_PATH = "/api/auth/remote";

/**
 * The MCP channel authenticates every request with a short-lived,
 * session-scoped bearer that this layer has no database to resolve. Shadowing
 * it with a second credential would break the agent tool channel for a check
 * that is strictly weaker than the one those routes already run
 * (`lib/mcp/http-auth.ts`).
 */
export const MCP_ROUTE_PREFIX = "/api/mcp/";

/** Hostnames that mean "this machine only". */
export const LOOPBACK_HOSTNAMES: readonly string[] = [
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
  "0:0:0:0:0:0:0:1",
];

const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

/**
 * Hostname out of a `Host` header value, IPv6 brackets kept:
 * `[::1]:3000` → `[::1]`, `example.com:3000` → `example.com`.
 */
export function extractHostname(headerValue: string): string {
  if (headerValue.startsWith("[")) {
    const end = headerValue.indexOf("]");
    return end >= 0 ? headerValue.slice(0, end + 1) : headerValue;
  }
  return headerValue.split(":")[0];
}

export function isLoopbackHostname(hostname: string | null): boolean {
  if (!hostname) return false;
  return LOOPBACK_HOSTNAMES.includes(hostname.toLowerCase());
}

/**
 * The configured credential, or null when Arij is in its default
 * loopback-only mode. Blank and whitespace-only are "not configured": an
 * empty env var must never mean "remote mode with an empty password".
 */
export function readRemoteToken(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw = env[REMOTE_TOKEN_ENV_VAR];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** True when this boot expects a credential on `/api/*`. */
export function isRemoteModeEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return readRemoteToken(env) !== null;
}

/**
 * The credential a request presents, in the order a client is likely to use:
 * the browser cookie, then an explicit header, then a bearer.
 *
 * A bearer is read last and only when it is not an MCP call, so an agent's
 * session token is never mistaken for a failed remote credential.
 */
export function presentedRemoteCredential(request: {
  headers: { get(name: string): string | null };
  cookies?: { get(name: string): { value: string } | undefined };
}): string | null {
  const cookie = request.cookies?.get(REMOTE_TOKEN_COOKIE)?.value;
  if (cookie) return cookie;

  const header = request.headers.get(REMOTE_TOKEN_HEADER);
  if (header) return header.trim() || null;

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = BEARER_PATTERN.exec(authorization)?.[1]?.trim();
  return bearer || null;
}

/**
 * Length-independent, early-exit-free comparison. Not a substitute for a real
 * `timingSafeEqual` — it cannot be, in a runtime that may not expose one —
 * but it removes the trivially observable "compare until first mismatch"
 * signal that `===` on strings gives away.
 */
export function credentialMatches(
  presented: string | null,
  expected: string | null,
): boolean {
  if (!presented || !expected) return false;
  let diff = presented.length ^ expected.length;
  const length = Math.max(presented.length, expected.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (presented.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Headers a SERVER-SIDE call to Arij's own HTTP API must carry in remote mode.
 *
 * Two flows re-enter the app over HTTP rather than calling the handler
 * directly — `lib/chat/board-tools.ts` (every chat board tool) and
 * `lib/mcp/create-bug.ts` — so that workflow guards, SSE events, the activity
 * log and the `arji.json` export all fire exactly once, in one place. They
 * leave and re-enter through the proxy like any other client, and so need the
 * credential like any other client.
 *
 * Empty in the default mode, which is why the call sites can spread it
 * unconditionally.
 */
export function internalApiCredentialHeaders(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const token = readRemoteToken(env);
  return token ? { [REMOTE_TOKEN_HEADER]: token } : {};
}
