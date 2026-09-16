import { projectContextSections } from "../prompt-sections";
/** Specification prompt composition. Project memory is resolved by the public facade. */
import {
  systemSection,
  chatHistorySection,
  projectHeader,
  descriptionSection,
} from "../prompt-sections";
import { neutralizeControlMarkup } from "../untrusted";
import type {
  PromptProject,
  PromptDocument,
  PromptMessage,
  PromptEpicStatus,
  PromptUserStoryStatus,
  PromptReleaseSummary,
  SpecRewriteBoardState,
  SpecRewriteReleaseContext,
} from "./types";

/**
 * Builds the prompt for generating or regenerating the project specification.
 * Claude Code runs in plan mode and is expected to return structured JSON
 * containing the spec, epics, and user stories.
 */
export function buildSpecGenerationPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  chatHistory: PromptMessage[],
  systemPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));
  parts.push(projectContextSections(project, documents));
  parts.push(chatHistorySection(chatHistory));

  parts.push(`## Task: Generate Project Specification & Plan

Based on the project description, uploaded documents, and conversation history above, produce a comprehensive project specification with an implementation plan.

## Rules

- The \`spec\` field should be a detailed markdown document covering: project overview, objectives, constraints, technical stack recommendations, architecture, and key decisions.
- Order epics by implementation priority (most foundational first).
- Priority values: 0 = low, 1 = medium, 2 = high, 3 = critical.
- Each epic should have 2-8 user stories with clear acceptance criteria.
- User stories should follow the "As a [role], I want [feature] so that [benefit]" format.
- Acceptance criteria should be a markdown checklist.
- Be specific and actionable -- avoid vague descriptions.
- If a current specification exists, refine and improve it rather than starting from scratch.
- Incorporate any relevant details from the reference documents and conversation history.

## CRITICAL OUTPUT FORMAT — YOU MUST FOLLOW THIS EXACTLY

Your ENTIRE response must be ONLY the raw JSON object below. Nothing else.

{
  "spec": "Full project specification in markdown...",
  "epics": [
    {
      "title": "Epic title",
      "description": "Detailed description of the epic",
      "priority": 0,
      "user_stories": [
        {
          "title": "As a [role], I want [feature] so that [benefit]",
          "description": "Detailed description",
          "acceptance_criteria": "- [ ] Criterion 1\\n- [ ] Criterion 2"
        }
      ]
    }
  ]
}

ABSOLUTE REQUIREMENTS:
- The very first character of your response MUST be \`{\`
- The very last character of your response MUST be \`}\`
- Do NOT wrap the JSON in \\\`\\\`\\\`json code blocks or any markdown.
- Do NOT write any text, explanation, or summary before or after the JSON.
- Do NOT say "Here is the spec" or any preamble — just output the raw JSON.
- If you include ANY text outside the JSON object, the automated parser will FAIL.
`);

  return parts.filter(Boolean).join("\n");
}

export const SPEC_UPDATE_MAX_EPICS = 30;

export const SPEC_UPDATE_MAX_STORIES_PER_EPIC = 20;

export const SPEC_UPDATE_MAX_RELEASES = 10;

export const SPEC_UPDATE_MAX_CHANGELOG_CHARS = 1000;

/**
 * Renders the live board (epics + user stories with their statuses) and the
 * release history as a compact markdown section. Pure: callers query the DB
 * and pass plain projections, keeping every builder testable without a
 * database.
 */
export function buildProjectStateSection(
  epics: PromptEpicStatus[],
  userStories: PromptUserStoryStatus[],
  releases: PromptReleaseSummary[],
): string {
  const parts: string[] = [];

  if (epics.length > 0) {
    parts.push(`### Board\n`);
    const storiesByEpic = new Map<string, PromptUserStoryStatus[]>();
    for (const story of userStories) {
      const list = storiesByEpic.get(story.epicId);
      if (list) list.push(story);
      else storiesByEpic.set(story.epicId, [story]);
    }
    const displayedEpics = epics.slice(0, SPEC_UPDATE_MAX_EPICS);
    const epicLines = displayedEpics.map((epic) => {
      const lines = [`- **${epic.title}** — ${epic.status || "backlog"}`];
      const stories = storiesByEpic.get(epic.id) ?? [];
      const displayedStories = stories.slice(
        0,
        SPEC_UPDATE_MAX_STORIES_PER_EPIC,
      );
      for (const story of displayedStories) {
        lines.push(`  - ${story.title} — ${story.status || "todo"}`);
      }
      if (stories.length > SPEC_UPDATE_MAX_STORIES_PER_EPIC) {
        lines.push(
          `  - _... and ${stories.length - SPEC_UPDATE_MAX_STORIES_PER_EPIC} more stories (truncated)_`,
        );
      }
      return lines.join("\n");
    });
    if (epics.length > SPEC_UPDATE_MAX_EPICS) {
      epicLines.push(
        `- _... and ${epics.length - SPEC_UPDATE_MAX_EPICS} more epics (truncated)_`,
      );
    }
    parts.push(epicLines.join("\n") + "\n");
  }

  if (releases.length > 0) {
    parts.push(`### Releases\n`);
    const displayedReleases = releases.slice(0, SPEC_UPDATE_MAX_RELEASES);
    const releaseLines = displayedReleases.map((release) => {
      const lines = [
        `- **${release.version}**${release.title ? ` — ${release.title}` : ""}`,
      ];
      if (release.changelog?.trim()) {
        let cl = release.changelog.trim();
        let wasTruncated = false;
        if (cl.length > SPEC_UPDATE_MAX_CHANGELOG_CHARS) {
          cl = cl.slice(0, SPEC_UPDATE_MAX_CHANGELOG_CHARS).trimEnd();
          wasTruncated = true;
        }
        const clLines = cl.split("\n").map((line) => `  ${line}`);
        if (wasTruncated) {
          clLines.push(`  _... [changelog truncated]_`);
        }
        lines.push(clLines.join("\n"));
      }
      return lines.join("\n");
    });
    if (releases.length > SPEC_UPDATE_MAX_RELEASES) {
      releaseLines.push(
        `- _... and ${releases.length - SPEC_UPDATE_MAX_RELEASES} older releases (truncated)_`,
      );
    }
    parts.push(releaseLines.join("\n") + "\n");
  }

  return parts.join("\n");
}

/**
 * Builds the prompt for an agent-run update of the project specification.
 * Like the distill flow, the agent runs in plan mode inside the project
 * workspace and its ENTIRE response is the replacement document — nothing is
 * persisted unless the session succeeds, so a failed run never touches the
 * stored spec.
 */
export function buildSpecUpdatePrompt(
  project: PromptProject,
  instruction?: string | null,
  systemPrompt?: string | null,
  projectState?: string | null,
): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));
  parts.push(projectContextSections(project, [], undefined, { description: true }));
  if (projectState?.trim()) {
    parts.push(`## Current Project State\n\n${projectState.trim()}`);
  }

  parts.push(`## Task: Update the Project Specification

You are running in plan mode inside the project's workspace. Rewrite the
project specification so it accurately reflects the current state of the
project: combine the specification above, the board and release state, and
what you find in the repository itself (code, docs, git history).

- Keep what is still accurate; correct or drop what is not.
- Cover: project overview, objectives, constraints, technical stack,
  architecture, and key decisions.
- Do not invent features that have no grounding in the project context.
`);

  if (instruction && instruction.trim()) {
    parts.push(`## User Instruction

The user asked for the following focus for this update. Follow it — it takes
precedence over the general guidance above where they conflict:

${instruction.trim()}
`);
  }

  parts.push(`## CRITICAL OUTPUT FORMAT — YOU MUST FOLLOW THIS EXACTLY

Your ENTIRE response must be ONLY the complete updated specification in raw
markdown. Nothing else.

- Do NOT wrap the document in \`\`\` code fences.
- Do NOT add commentary, summaries, or explanations before or after it.
- Do NOT output a diff — output the full replacement document.
- If you output ANYTHING besides the markdown document, the automated parser
  will FAIL and the update will be discarded.
`);

  return parts.filter(Boolean).join("\n");
}

function specRewriteBoardSection(board: SpecRewriteBoardState): string {
  const lines: string[] = [`## Current Board State\n`];
  if (board.epics.length === 0) {
    lines.push(`(No tickets on the board.)\n`);
  }
  for (const epic of board.epics) {
    lines.push(`- **${epic.title}** — ${epic.status}`);
    const stories = board.userStories.filter((s) => s.epicId === epic.id);
    for (const story of stories) {
      lines.push(`  - ${story.title} (${story.status})`);
    }
  }
  if (board.releases.length > 0) {
    lines.push(``, `### Release History`);
    for (const release of board.releases) {
      lines.push(
        `- v${release.version}${release.title ? ` — ${release.title}` : ""}`,
      );
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Builds the prompt for the automatic spec rewrite fired after a release.
 * Like the memory distill, the current spec is the object being rewritten
 * and gets its own framing instead of the standard injected section — and,
 * like it, the document is neutralised on the way in. This path runs
 * unattended and writes its result back to `projects.spec`, so a directive
 * left in the stored spec would otherwise be read, obeyed and re-persisted.
 */
export function buildSpecAutoRewritePrompt(
  project: PromptProject,
  currentSpec: string | null,
  board: SpecRewriteBoardState,
  release: SpecRewriteReleaseContext,
  systemPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));
  parts.push(projectHeader(project.name));
  parts.push(descriptionSection(project.description));

  parts.push(`## Current Specification\n`);
  if (currentSpec && currentSpec.trim().length > 0) {
    // Unfenced by design (see the docblock) — so this is the whole defence,
    // on the one path whose output is written back over the document itself.
    parts.push(neutralizeControlMarkup(currentSpec.trim()) + "\n");
  } else {
    parts.push(`(The project specification is currently empty.)\n`);
  }

  parts.push(specRewriteBoardSection(board));

  parts.push(
    `## Release That Just Shipped\n`,
    `- **Version:** v${release.version}${release.title ? ` — ${release.title}` : ""}\n`,
  );
  if (release.changelog && release.changelog.trim()) {
    parts.push(`### Changelog\n`, release.changelog.trim() + "\n");
  }

  parts.push(`## Task: Rewrite the Specification to Match Reality

This project's specification is a living document: it is injected into every agent prompt for this project, so it must describe the project as it IS today — not as it was when first written. A release was just published; update the specification accordingly.

Rewrite the ENTIRE specification above so that:

- Features delivered by shipped releases are presented as implemented reality (current behaviour), not as future plans.
- Architecture and key-decisions sections reflect what was actually built, incorporating decisions taken during implementation.
- Objectives and scope stay accurate: drop or rewrite goals the project has outgrown, keep genuine future direction clearly framed as plans (backlog / next steps).
- The changelog of the release above is evidence of what changed — fold its facts in, but write prose, not a copy of the changelog.
- Preserve the document's overall structure and voice where they are still accurate; this is a refresh, not a restart.

### Output Format

Your ENTIRE response must be ONLY the new specification, as raw markdown.

- Do NOT wrap it in code fences.
- Do NOT add any preamble, explanation, or summary before or after it.
- Do NOT address the user — the response is written verbatim into the project specification.
`);

  return parts.filter(Boolean).join("\n");
}
