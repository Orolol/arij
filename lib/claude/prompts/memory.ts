/** Memory rewrites compose only the explicitly supplied source document and evidence. */
import { systemSection, projectHeader, descriptionSection } from "../prompt-sections";
import { PROJECT_MEMORY_MAX_CHARS, PROJECT_MEMORY_MAX_TOKENS } from "@/lib/documents/memory-constants";
// Shared with the workflow's output validator: one heading contract.
import { DREAMING_MEMORY_SECTIONS } from "@/lib/workflow/dreaming-constants";
import { fenceAgentOutput, neutralizeControlMarkup } from "../untrusted";
import type { PromptProject, MemoryDistillSessionContext, DreamingDigestContext } from "./types";

/**
 * Builds the prompt for the 'memory_distill' agent: merge what the
 * just-finished session taught into the project's memory document.
 *
 * Deliberately does NOT inject the memory section like other builders — the
 * current memory is the object being rewritten and gets its own framing:
 * a heading and the document itself, not a fenced reference block it would
 * then be asked to quote back.
 *
 * That framing is not a defence, though. The memory document is written by
 * agents (this builder's own sessions, and Dreaming), so it is neutralised
 * on the way in exactly as `memorySection` neutralises the record channel —
 * only the fence differs.
 *
 * `sessionContext.resultSummary` is a second channel and gets the stronger
 * treatment: it is the finished session's own last message, so it is
 * neutralised AND fenced under the agent-output notice. Evidence is quoted
 * from rather than reproduced, which makes a fence free here in a way it is
 * not for the document above — and the stakes are the same, since what this
 * session writes is injected into every later prompt for the project.
 */
export function buildMemoryDistillPrompt(
  project: PromptProject,
  currentMemory: string | null,
  sessionContext: MemoryDistillSessionContext,
  systemPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));
  parts.push(projectHeader(project.name));

  parts.push(`## Current Project Memory\n`);
  if (currentMemory && currentMemory.trim().length > 0) {
    // Unfenced by design (see the docblock) — so this is the whole defence.
    parts.push(neutralizeControlMarkup(currentMemory.trim()) + "\n");
  } else {
    parts.push(`(The project memory is currently empty.)\n`);
  }

  parts.push(`## Just-Finished Session\n`);
  const contextLines: string[] = [];
  if (sessionContext.ticketTitle) {
    contextLines.push(`- **Ticket:** ${sessionContext.ticketTitle.trim()}`);
  }
  if (sessionContext.agentType) {
    contextLines.push(`- **Agent type:** ${sessionContext.agentType}`);
  }
  if (sessionContext.outcome) {
    contextLines.push(`- **Outcome:** ${sessionContext.outcome}`);
  }
  parts.push(
    (contextLines.length > 0
      ? contextLines.join("\n")
      : "(No session metadata available.)") + "\n",
  );
  if (sessionContext.resultSummary && sessionContext.resultSummary.trim()) {
    parts.push(`### Session Result\n`);
    // The finished session's own last message: agent output, and this
    // builder's result becomes the memory injected into every later prompt.
    // Fenced as well as neutralised — unlike the memory above, this is
    // evidence to read, not a document to reproduce.
    parts.push(fenceAgentOutput(sessionContext.resultSummary) + "\n");
  }

  parts.push(`## Task: Distill Project Memory

You maintain this project's long-term memory: a compact markdown document of durable, non-obvious conventions that future agent sessions must know. It is injected into every agent prompt for this project.

Rewrite the ENTIRE memory document, merging anything durable the just-finished session revealed into the current memory above.

### Rules

- KEEP it durable: coding conventions, architectural decisions, recurring pitfalls, commands that must (or must not) be used, naming/structure rules.
- NEVER include per-ticket trivia: ticket titles, one-off bug details, session outcomes, dates, progress notes, or anything only relevant to a single change.
- MERGE, don't append: deduplicate against the current memory, rewrite entries to stay general, and drop entries the session proved wrong or obsolete.
- If the session revealed nothing durable, return the current memory (cleaned up if useful) unchanged in substance.
- Prefer short bullet points grouped under a few \`##\` headings.
- HARD LIMIT: the document must stay under ${PROJECT_MEMORY_MAX_TOKENS} tokens (about ${PROJECT_MEMORY_MAX_CHARS} characters). Cut the least valuable entries first if space runs out.

### Output Format

Your ENTIRE response must be ONLY the new memory document body, as raw markdown.

- Do NOT wrap it in code fences.
- Do NOT add any preamble, explanation, or summary before or after it.
- Do NOT address the user — the response is written verbatim into the memory document.
`);

  return parts.filter(Boolean).join("\n");
}

/**
 * Builds the prompt for the 'dreaming' agent: read the last N terminal
 * sessions across the whole project — successes AND failures — and rewrite the
 * memory document around what only the batch reveals.
 *
 * Like the distill and the spec rewrite, the current memory is the object
 * being rewritten and gets its own framing instead of the standard injected
 * section (callers pass `memory: null` so the builder-level injection cannot
 * duplicate it). The document is still neutralised: unfenced framing changes
 * how it reads, not whether it can impersonate a control turn.
 *
 * The digest is the evidence channel and is fenced as well as neutralised.
 * It is assembled from dozens of sessions' final-response tails, errors,
 * forensic reports and findings, and its own `###` session headings sit
 * directly above the `##` sections that carry this prompt's instructions —
 * so the boundary has to be one the content cannot cross.
 */
export function buildDreamingPrompt(
  project: PromptProject,
  currentMemory: string | null,
  context: DreamingDigestContext,
  systemPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));
  parts.push(projectHeader(project.name));
  parts.push(descriptionSection(project.description));

  parts.push(`## Current Project Memory\n`);
  if (currentMemory && currentMemory.trim().length > 0) {
    // Unfenced by design (see the docblock) — so this is the whole defence.
    parts.push(neutralizeControlMarkup(currentMemory.trim()) + "\n");
  } else {
    parts.push(`(The project memory is currently empty.)\n`);
  }

  const coverage: string[] = [
    `- **Sessions analyzed:** ${context.sessionCount}`,
    `- **Window start:** ${context.sinceIso}`,
  ];
  if (context.truncatedCount) {
    coverage.push(
      `- **Truncated to fit the size budget:** ${context.truncatedCount} session(s) — their records end with a cut marker.`,
    );
  }
  if (context.droppedCount) {
    coverage.push(
      `- **Omitted entirely (size budget):** ${context.droppedCount} session(s).`,
    );
  }

  parts.push(`## Recent Sessions Digest\n`);
  parts.push(coverage.join("\n") + "\n");
  parts.push(
    context.digest.trim().length > 0
      // Up to 30 sessions' final-response tails, errors, forensic reports and
      // findings — all agent output. Fenced as well as neutralised: the
      // digest's own `###` session headings must not be able to grow into the
      // `##` sections this prompt uses for its instructions.
      ? fenceAgentOutput(context.digest) + "\n"
      : "(No session records available.)\n",
  );

  parts.push(`## Task: Dream the Project Memory

You are running a **dreaming** pass: a cross-session review of everything the agents on this project just lived through. A single session only ever shows its own story; the digest above shows dozens, successes and failures side by side. Your job is to find what NO single session could show — the mistakes that keep repeating, the traps this codebase keeps setting, the approaches that actually land — and rewrite the project's long-term memory around them.

This memory document is injected into every agent prompt for this project. It is the one lever that makes the next session start smarter than the last.

### How to read the digest

- **Failures and refused transitions are the richest signal.** A run that failed, went silent, or had its ticket move refused tells you more than a clean success.
- **Repetition is the whole point.** Something that went wrong ONCE is trivia. Something that went wrong three times across different tickets is a rule worth writing.
- **Blocking findings and forensic reports name the actual defect** — generalize them into a rule, never copy the incident.
- **Compare what worked with what did not**: same kind of ticket, different outcome, is where a strategy hides.

### Required structure

Rewrite the ENTIRE document using EXACTLY these four \`##\` sections, in this order, even if a section ends up short:

${DREAMING_MEMORY_SECTIONS.map((title) => `## ${title}`).join("\n")}

- **${DREAMING_MEMORY_SECTIONS[0]}** — non-obvious traps in this repository: files that regenerate themselves, commands that must not be run, structures that break when touched naively.
- **${DREAMING_MEMORY_SECTIONS[1]}** — what agents on this project get wrong again and again, phrased as a correction.
- **${DREAMING_MEMORY_SECTIONS[2]}** — approaches the digest shows actually working: how to scope work, where to put tests, what to verify before declaring done.
- **${DREAMING_MEMORY_SECTIONS[3]}** — standing instructions for the next build session: conventions, workflow rules, ceilings it must respect.

### Rules

- KEEP the durable entries already in the current memory. Merge, deduplicate, sharpen — do NOT start from a blank page, and do not drop a rule just because this window did not exercise it.
- DROP entries the digest proved wrong or obsolete.
- NEVER include per-ticket trivia: ticket titles, ids, session ids, dates, costs, provider names, or one-off incident details. Every line must be true for the NEXT session too.
- Prefer short, imperative bullet points. Give the reason when it is not obvious ("X, because Y").
- If the digest supports nothing new for a section, keep whatever the current memory already had under it rather than inventing filler.
- HARD LIMIT: the document must stay under ${PROJECT_MEMORY_MAX_TOKENS} tokens (about ${PROJECT_MEMORY_MAX_CHARS} characters). Cut the least valuable entries first if space runs out.

### Output Format

Your ENTIRE response must be ONLY the new memory document body, as raw markdown.

- Do NOT wrap it in code fences.
- Do NOT add any preamble, explanation, or summary before or after it.
- Do NOT address the user — the response is written verbatim into the memory document.
`);

  return parts.filter(Boolean).join("\n");
}
