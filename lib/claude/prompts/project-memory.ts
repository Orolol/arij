import { getProjectMemoryContent } from "@/lib/documents/memory";
import type { PromptProject } from "./types";

/**
 * Preserve implicit memory injection for dispatchers that pass a project row.
 * Explicit null/empty means resolved with no memory; no id means no lookup.
 * Composition receives a new projection only when resolution is needed.
 */
export function withStoredProjectMemory<Args extends unknown[]>(
  compose: (project: PromptProject, ...args: Args) => string,
): (project: PromptProject, ...args: Args) => string {
  return (project, ...args) => {
    const resolved = project.memory === undefined && project.id
      ? { ...project, memory: getProjectMemoryContent(project.id) }
      : project;
    return compose(resolved, ...args);
  };
}
