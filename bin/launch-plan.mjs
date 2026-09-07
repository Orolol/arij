/**
 * How `arij` decides what to hand the `next` binary — extracted from
 * `arij.mjs` so it can be asserted on without spawning a server.
 *
 * THE DEFAULT IS LOOPBACK. `next dev` and `next start` bind `0.0.0.0` when no
 * `-H` is passed, which put Arij's entirely unauthenticated `/api/*` surface
 * on every interface of the machine. `proxy.ts` could not compensate: it is
 * handed a request, not a socket, so its only notion of "local" came from the
 * `Host` header, and any non-browser client writes that itself.
 *
 * REMOTE IS AN OPT-IN THAT CARRIES A SECRET. Asking for a non-loopback host is
 * a legitimate thing to want; doing it silently is not. When the resolved host
 * is remote this mints a per-boot credential (or adopts the operator's), puts
 * it in the child's environment as ARIJ_REMOTE_TOKEN — which is what switches
 * `proxy.ts` into requiring it — and returns the one bootstrap URL that hands
 * it to a browser.
 *
 * Plain `.mjs`, and published: `bin/` is in package.json `files`, and this
 * runs long before anything is compiled.
 */

import { randomBytes } from "node:crypto";

/** What Arij binds when nobody says otherwise. */
export const DEFAULT_BIND_HOST = "127.0.0.1";

/** Env var `proxy.ts` reads to decide that a credential is required. */
export const REMOTE_TOKEN_ENV_VAR = "ARIJ_REMOTE_TOKEN";

/** Overrides the default host without a flag (`ARIJ_HOST=0.0.0.0 arij`). */
export const HOST_ENV_VAR = "ARIJ_HOST";

/** Path that trades the credential for a browser cookie. */
export const REMOTE_AUTH_BOOTSTRAP_PATH = "/api/auth/remote";

/** Hostnames that mean "this machine only". */
const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0:0:0:0:0:0:0:1",
]);

/** Commands that start a listener, and therefore take a host. */
const SERVING_COMMANDS = new Set(["dev", "start"]);

const HOST_FLAGS = new Set(["-H", "--host", "--hostname"]);
const PORT_FLAGS = new Set(["-p", "--port"]);

const DEFAULT_PORT = "3000";

export function isLoopbackHost(host) {
  return LOOPBACK_HOSTNAMES.has(String(host).toLowerCase());
}

/**
 * A URL-safe 43-character secret. `randomBytes` rather than `Math.random`:
 * this is the only thing standing between a LAN peer and a shell.
 */
function mintToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * Pull `--host`/`-H` and `--port`/`-p` out of the user's arguments, keeping
 * everything else in order for `next`. Both `--host x` and `--host=x` are
 * accepted, because both work on every other CLI the user has just used.
 */
function extractFlag(args, flags) {
  const rest = [];
  let value = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const equals = arg.indexOf("=");
    const name = equals >= 0 ? arg.slice(0, equals) : arg;

    if (!flags.has(name)) {
      rest.push(arg);
      continue;
    }

    if (equals >= 0) {
      value = arg.slice(equals + 1);
      continue;
    }
    // A trailing `--host` with nothing after it: hand it back to next, which
    // owns the argument-error message.
    if (i + 1 >= args.length) {
      rest.push(arg);
      continue;
    }
    value = args[i + 1];
    i += 1;
  }

  return { value, rest };
}

/**
 * @typedef {object} LaunchPlan
 * @property {"dev"|"build"|"start"|"help"|"version"|"unknown"} command
 * @property {string[]} nextArgs   Argument vector for the `next` binary.
 * @property {string|null} host    Resolved bind host; null when none applies.
 * @property {string|null} port    Explicit port, or null for Next's default.
 * @property {boolean} remote      True when the host is not loopback.
 * @property {string|null} remoteToken
 * @property {Record<string, string>} childEnv  Merged over the child's env.
 * @property {string[]} notices    Lines to print before handing over.
 * @property {string} [unknownCommand]
 */

/**
 * Resolve argv + environment into everything `arij.mjs` needs.
 *
 * `childEnv` holds only what must be ADDED to the environment; `notices` are
 * lines to print before handing over.
 *
 * `generateToken` is injectable so a test can assert on the handoff without
 * asserting on randomness.
 *
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [env]
 * @param {() => string} [generateToken]
 * @returns {LaunchPlan}
 */
export function resolveLaunchPlan(
  argv,
  env = process.env,
  generateToken = mintToken,
) {
  const args = [...argv];
  const first = args[0];

  if (first === "--help" || first === "-h") {
    return inertPlan("help");
  }
  if (first === "--version" || first === "-v") {
    return inertPlan("version");
  }

  let command;
  if (!first || first === "start") {
    command = "start";
    if (first) args.shift();
  } else if (first === "dev" || first === "build") {
    command = first;
    args.shift();
  } else {
    return { ...inertPlan("unknown"), unknownCommand: first };
  }

  if (!SERVING_COMMANDS.has(command)) {
    // `build` opens no socket; a host flag there is meaningless, so the
    // arguments pass through untouched.
    return {
      command,
      nextArgs: [command, ...args],
      host: null,
      port: null,
      remote: false,
      remoteToken: null,
      childEnv: {},
      notices: [],
    };
  }

  const host = extractFlag(args, HOST_FLAGS);
  // The port is READ, not rewritten: it only feeds the bootstrap URL, and the
  // user's own flag spelling passes through to Next untouched. Playwright runs
  // `npm run dev -- --port 3100`, and a launcher that quietly normalised that
  // to `-p` would be one more thing to notice when it broke.
  const port = extractFlag(host.rest, PORT_FLAGS);

  const resolvedHost =
    host.value ?? env[HOST_ENV_VAR]?.trim() ?? DEFAULT_BIND_HOST;
  const resolvedPort = port.value ?? null;

  const nextArgs = [command, "-H", resolvedHost, ...host.rest];

  if (isLoopbackHost(resolvedHost)) {
    return {
      command,
      nextArgs,
      host: resolvedHost,
      port: resolvedPort,
      remote: false,
      remoteToken: null,
      childEnv: {},
      notices: [],
    };
  }

  const supplied = env[REMOTE_TOKEN_ENV_VAR]?.trim();
  const remoteToken = supplied || generateToken();

  return {
    command,
    nextArgs,
    host: resolvedHost,
    port: resolvedPort,
    remote: true,
    remoteToken,
    childEnv: { [REMOTE_TOKEN_ENV_VAR]: remoteToken },
    notices: remoteNotices(resolvedHost, resolvedPort ?? DEFAULT_PORT, remoteToken, Boolean(supplied)),
  };
}

/**
 * @param {LaunchPlan["command"]} command
 * @returns {LaunchPlan}
 */
function inertPlan(command) {
  return {
    command,
    nextArgs: [],
    host: null,
    port: null,
    remote: false,
    remoteToken: null,
    childEnv: {},
    notices: [],
  };
}

/**
 * The banner. The token appears on exactly ONE line — the bootstrap URL —
 * because every extra copy is another place it can be scrolled back to,
 * screen-shared, or scraped out of a terminal log.
 */
function remoteNotices(host, port, token, supplied) {
  // 0.0.0.0 is a bind address, not somewhere a browser can go.
  const reachable = host === "0.0.0.0" || host === "::" ? "<this-machine>" : host;
  return [
    "",
    `Arij is listening on ${host}:${port} — NOT just this machine.`,
    supplied
      ? `Using the ARIJ_REMOTE_TOKEN you supplied. /api/* now requires it.`
      : `A per-boot access credential was generated. /api/* now requires it.`,
    "",
    "  Open this once, in the browser you want to use:",
    `  http://${reachable}:${port}${REMOTE_AUTH_BOOTSTRAP_PATH}?token=${token}`,
    "",
    "  It sets an HttpOnly cookie and redirects; the credential is gone from",
    "  the address bar. It is valid for this boot only.",
    "",
    "  Agents run with the permissions of this user. Do not expose Arij to a",
    "  network you do not control, and prefer an SSH tunnel where you can.",
    "",
  ];
}
