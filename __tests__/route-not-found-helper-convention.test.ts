import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Convention pin: an API route must not re-implement the project/epic/story
 * lookups that `lib/api/route-helpers.ts` already owns.
 *
 * Seven routes used to inline `SELECT id FROM projects WHERE id = ?` and hand
 * back `{ error: "Project not found" }` — without the project scoping the
 * helpers add (an epic id from another project must 404, not resolve). The
 * duplication is invisible at review time; this test makes it mechanical.
 *
 * The rule is text: no `app/api` file may contain the helpers' refusal prose
 * unless it is one of the two documented exception classes below.
 */

const API_DIR = path.join(process.cwd(), "app", "api");

/**
 * Files that may name the prose, with the reason. Two classes:
 *
 *  - the MCP surface, whose refusal carries a machine-readable `code` the tool
 *    bridge branches on (`{ error, code: "PROJECT_NOT_FOUND" }`), a different
 *    contract from the HTTP helpers' plain 404;
 *  - DELETE handlers mapping `ScopedDeleteNotFoundError` thrown by
 *    `deleteTicket` / `deleteUserStoryPermanently`. The scoping lives in the
 *    service, so a pre-read through the helper would be a second query with no
 *    new information.
 */
const ALLOWED = new Map<string, string>([
  [
    "app/api/mcp/create-planning-ticket/route.ts",
    "MCP refusal carries `code: PROJECT_NOT_FOUND`, a different contract.",
  ],
  [
    "app/api/projects/[projectId]/epics/[epicId]/route.ts",
    "DELETE maps ScopedDeleteNotFoundError; the service owns the scoping.",
  ],
  [
    "app/api/projects/[projectId]/stories/[storyId]/route.ts",
    "DELETE maps ScopedDeleteNotFoundError; the service owns the scoping.",
  ],
]);

const FORBIDDEN_PROSE =
  /"Project not found"|"Epic not found"|"Story not found"/;

function collectRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectRouteFiles(full, out);
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

describe("route not-found helper convention", () => {
  it("keeps every exception pointing at a route that still exists", () => {
    for (const relative of ALLOWED.keys()) {
      expect(fs.existsSync(path.join(process.cwd(), relative)), relative).toBe(true);
    }
  });

  it("has no route re-implementing the helper's refusal, outside the documented exceptions", () => {
    const offenders = collectRouteFiles(API_DIR)
      .filter((file) => FORBIDDEN_PROSE.test(fs.readFileSync(file, "utf-8")))
      .map((file) => path.relative(process.cwd(), file))
      .filter((relative) => !ALLOWED.has(relative));

    expect(
      offenders,
      "These routes hand-roll a project/epic/story 404 instead of calling " +
        "getProjectOr404 / getEpicOr404 / getStoryOr404 from lib/api/route-helpers.ts. " +
        "Use the helper, or add a documented exception above."
    ).toEqual([]);
  });
});
