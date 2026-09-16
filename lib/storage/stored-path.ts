import path from "node:path";

export function isStoredPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative.length > 0 && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Callers supply a statically scoped root; database paths cannot escape it. */
export function resolveStoredPath(root: string, prefix: string, storedPath: unknown): string | null {
  if (typeof storedPath !== "string" || storedPath.includes("\0")) return null;
  const clean = storedPath.trim().replace(/^\.\//, "");
  if (!clean.startsWith(`${prefix}/`)) return null;
  const candidate = path.resolve(root, clean.slice(prefix.length + 1));
  return isStoredPathWithin(root, candidate) ? candidate : null;
}
