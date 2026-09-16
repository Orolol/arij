import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Runtime user files are never deployment assets. Resolved from projectDir. */
export const runtimeTraceExcludes = ["./data/**/*"];

/**
 * Next 16.3 applies outputFileTracingExcludes to routes but skips the separate
 * instrumentation trace. Apply the same boundary after compilation, before
 * Next copies traced assets for a standalone build. Only the manifest changes;
 * no runtime file is opened, copied, or removed.
 *
 * @param {{ distDir: string, projectDir: string }} metadata
 */
export async function excludeInstrumentationRuntimeFiles({ distDir, projectDir }) {
  const manifestPath = path.resolve(projectDir, distDir, "server", "instrumentation.js.nft.json");
  let contents;
  try {
    contents = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  const manifest = JSON.parse(contents);
  const runtimeRoot = path.resolve(projectDir, "data");
  const manifestDir = path.dirname(manifestPath);
  const files = manifest.files.filter((file) => {
    const relative = path.relative(runtimeRoot, path.resolve(manifestDir, file));
    const isRuntime = relative === "" ||
      (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
    return !isRuntime;
  });
  if (files.length !== manifest.files.length) {
    await writeFile(manifestPath, JSON.stringify({ ...manifest, files }));
  }
}
