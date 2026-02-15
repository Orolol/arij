/**
 * Shared prompt section helpers.
 *
 * Each function produces a self-contained markdown block (or empty string when
 * the input is empty/null). Compose them inside the builder functions in
 * `prompt-builder.ts`.
 */

import type {
  PromptDocument,
  PromptEpic,
  PromptMessage,
  PromptProject,
} from "./prompt-builder";

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/** Returns `## heading\n\ncontent\n` or `""` when content is empty/null. */
export function section(heading: string, content: string | null | undefined): string {
  if (!content || content.trim().length === 0) return "";
  return `## ${heading}\n\n${content.trim()}\n`;
}

/** Wraps a system prompt as `# System Instructions` block. */
export function systemSection(systemPrompt: string | null | undefined): string {
  if (!systemPrompt || systemPrompt.trim().length === 0) return "";
  return `# System Instructions\n\n${systemPrompt.trim()}\n\n`;
}

/** Formats reference documents separated by `---`. */
export function documentsSection(documents: PromptDocument[]): string {
  if (documents.length === 0) return "";
  const parts = documents.map(
    (doc) => `### ${doc.name}\n\n${doc.contentMd.trim()}`,
  );
  return `## Reference Documents\n\n${parts.join("\n\n---\n\n")}\n`;
}

/** Lists existing epic titles for deduplication context. */
export function existingEpicsSection(existingEpics: PromptEpic[]): string {
  if (existingEpics.length === 0) return "";
  const list = existingEpics.map((epic) => `- ${epic.title}`).join("\n");
  return `## Existing Epics\n\n${list}\n`;
}

/** Formats a conversation history block with role prefixes. */
export function chatHistorySection(messages: PromptMessage[]): string {
  if (messages.length === 0) return "";
  const formatted = messages.map((msg) => {
    const prefix = msg.role === "user" ? "**User:**" : "**Assistant:**";
    return `${prefix}\n${msg.content.trim()}`;
  });
  return `## Conversation History\n\n${formatted.join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Semantic helpers — named after the prompt *concept* they represent
// ---------------------------------------------------------------------------

/** Returns the `# Project: {name}` heading. */
export function projectHeader(name: string): string {
  return `# Project: ${name}\n`;
}

/** Alias for `section("Project Description", ...)`. */
export function descriptionSection(description: string | null | undefined): string {
  return section("Project Description", description);
}

/** Alias for `section("Project Specification", ...)`. */
export function specSection(spec: string | null | undefined): string {
  return section("Project Specification", spec);
}

// ---------------------------------------------------------------------------
// Composite helpers
// ---------------------------------------------------------------------------

/**
 * Standard project context block used by most builders:
 * `# Project: {name}` + Description + Specification + Reference Documents.
 *
 * Returns the parts joined as a single string (empty sections omitted).
 */
export function projectContextSections(
  project: PromptProject,
  documents: PromptDocument[],
): string {
  const parts = [
    projectHeader(project.name),
    descriptionSection(project.description),
    specSection(project.spec),
    documentsSection(documents),
  ];
  return parts.filter(Boolean).join("\n");
}
