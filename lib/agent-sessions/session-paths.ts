/**
 * Where a session's durable artifacts live.
 *
 * Artifact readers and dispatchers resolve the same runtime directory.
 * Existing sessions are user data, never assets of a deployed application.
 */

import path from "node:path";
import fs from "node:fs";

/**
 * Absolute path of `data/sessions`, or of an explicit override.
 *
 * The override exists for tests, which point the whole artifact tree at a
 * temporary directory. Such a path is opaque to static analysis by
 * construction and never exists in a production build, so the trace is opted
 * out of on that branch rather than being allowed to widen to the project.
 */
export function resolveSessionsRoot(override?: string): string {
  if (override === undefined) {
    return path.join(process.cwd(), "data", "sessions");
  }

  return path.resolve(/*turbopackIgnore: true*/ override);
}

/**
 * Runtime session output is user data, not a build asset. Resolve the dynamic
 * directory without tracing every previous session into the server bundle.
 */
export function createSessionLogsPath(sessionId: string): string {
  const logsDir = path.join(/* turbopackIgnore: true */ resolveSessionsRoot(), sessionId);
  fs.mkdirSync(logsDir, { recursive: true });
  return path.join(logsDir, "logs.json");
}
