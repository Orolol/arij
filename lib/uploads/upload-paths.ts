import { resolveStoredPath } from "@/lib/storage/stored-path";
/**
 * The one place that turns an upload's stored path into an absolute one.
 *
 * Two rules meet here, and neither may move on its own.
 *
 * **Containment is a security boundary.** `chat_attachments.file_path` and
 * `epics.images` are free-form text. The sides that consume them serve bytes
 * to a browser, unlink files, and hand paths to an agent as things to open —
 * so a stored value that points anywhere other than this app's own
 * `data/uploads/` is refused rather than resolved.
 *
 * **Static scoping is a build constraint.** Turbopack traces filesystem access
 * statically. `path.join(process.cwd(), <a database string>)` is an unscoped
 * access: the build concludes that anything under the project may be read and
 * copies every source file — and `public/` — into the server output bundle,
 * warning "Dynamic filesystem access causes tracing of the whole project". The
 * literal `"data", "uploads"` segments below are what keep the trace inside
 * the uploads directory, and they have to be literal *at the join*: a call to
 * `uploadsDirectoryFor()` is opaque to the analyzer even though its body is a
 * constant template.
 *
 * Callers therefore never join a cwd-relative upload path themselves. They ask
 * here, and the two rules stay enforced together.
 *
 * Server-only: `process.cwd()` has no meaning in a browser bundle. The
 * client-safe path rules live in `ticket-images.ts`.
 */

import path from "path";

/** Repo-relative directory every project's uploads live under. */
const UPLOADS_RELATIVE_ROOT = "data/uploads";

/** Absolute path of `data/uploads`. */
export function uploadsRoot(): string {
  return path.join(process.cwd(), "data", "uploads");
}

/** Absolute path of one project's upload directory. */
export function projectUploadsDirectory(projectId: string): string {
  return path.join(process.cwd(), "data", "uploads", projectId);
}

/**
 * Absolute path of one project's upload, by file name.
 *
 * The name is expected to have passed `isServableUploadFileName` — this
 * rebuilds a path from validated parts, it does not validate them.
 */
export function uploadFileAbsolutePath(
  projectId: string,
  fileName: string
): string {
  return path.join(process.cwd(), "data", "uploads", projectId, fileName);
}

/**
 * Whether an absolute path is a *strict* descendant of the uploads root.
 *
 * The root itself is not: nothing legitimate stores it, and letting it through
 * would hand a directory to `readFileSync` or `unlinkSync`.
 */

/**
 * The absolute path a stored `data/uploads/<projectId>/<file>` value names, or
 * `null` when it names anything else.
 *
 * The stored prefix is checked *and* the resolved path is re-checked: the
 * first refuses a path that was never an upload's (`package.json`, an absolute
 * path, another `data/` folder), the second refuses one that starts out
 * looking like an upload's and climbs back out
 * (`data/uploads/p/../../../package.json`). A prefix check alone would accept
 * that second one.
 *
 * A leading `./` and surrounding whitespace are tolerated because the reader
 * in `ticket-images.ts` tolerates them, and the two must agree on what a
 * stored path means.
 */
export function storedUploadAbsolutePath(storedPath: unknown): string | null {
  return resolveStoredPath(path.join(process.cwd(), "data", "uploads"), UPLOADS_RELATIVE_ROOT, storedPath);
}
