/**
 * Prompt composition for all Claude Code interactions in Arij.
 *
 * Each builder assembles a structured markdown prompt from project data,
 * documents, epics/user stories, and the global system prompt configured
 * in settings.
 */

// ---------------------------------------------------------------------------
// Types — lightweight projections of the Drizzle schema rows
// ---------------------------------------------------------------------------

export interface PromptProject {
  name: string;
  description?: string | null;
  spec?: string | null;
}

export interface PromptDocument {
  name: string;
  contentMd: string;
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: string;
}

export interface PromptEpic {
  title: string;
  description?: string | null;
}

export interface PromptUserStory {
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function section(heading: string, content: string | null | undefined): string {
  if (!content || content.trim().length === 0) return "";
  return `## ${heading}\n\n${content.trim()}\n`;
}

function globalSection(globalPrompt: string | null | undefined): string {
  if (!globalPrompt || globalPrompt.trim().length === 0) return "";
  return `# Global Instructions\n\n${globalPrompt.trim()}\n\n`;
}

function documentsSection(documents: PromptDocument[]): string {
  if (documents.length === 0) return "";

  const parts = documents.map(
    (doc) => `### ${doc.name}\n\n${doc.contentMd.trim()}`,
  );

  return `## Reference Documents\n\n${parts.join("\n\n---\n\n")}\n`;
}

function chatHistorySection(messages: PromptMessage[]): string {
  if (messages.length === 0) return "";

  const formatted = messages.map((msg) => {
    const prefix = msg.role === "user" ? "**User:**" : "**Assistant:**";
    return `${prefix}\n${msg.content.trim()}`;
  });

  return `## Conversation History\n\n${formatted.join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// 1. Chat Brainstorm Prompt
// ---------------------------------------------------------------------------

/**
 * Builds the prompt for the brainstorm chat panel.
 * Claude Code runs in plan mode to discuss ideas and refine the project.
 */
export function buildChatPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  messages: PromptMessage[],
  globalPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(globalSection(globalPrompt));

  parts.push(`# Project: ${project.name}\n`);

  parts.push(section("Project Description", project.description));
  parts.push(section("Project Specification", project.spec));
  parts.push(documentsSection(documents));
  parts.push(chatHistorySection(messages));

  parts.push(`## Instructions

You are helping brainstorm and refine this project. Answer the user's latest message considering the full project context above. Be specific, actionable, and reference the project's existing specification and documents when relevant.

If the user asks about architecture, features, or implementation details, provide concrete suggestions grounded in the project's context.
`);

  return parts.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// 2. Spec Generation Prompt
// ---------------------------------------------------------------------------

/**
 * Builds the prompt for generating or regenerating the project specification.
 * Claude Code runs in plan mode and is expected to return structured JSON
 * containing the spec, epics, and user stories.
 */
export function buildSpecGenerationPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  chatHistory: PromptMessage[],
  globalPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(globalSection(globalPrompt));

  parts.push(`# Project: ${project.name}\n`);

  parts.push(section("Project Description", project.description));
  parts.push(section("Current Specification", project.spec));
  parts.push(documentsSection(documents));
  parts.push(chatHistorySection(chatHistory));

  parts.push(`## Task: Generate Project Specification & Plan

Based on the project description, uploaded documents, and conversation history above, produce a comprehensive project specification with an implementation plan.

## Output Format (JSON)

Return a single JSON object with the following structure:

\`\`\`json
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
\`\`\`

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

## CRITICAL OUTPUT RULES

Your final response MUST be ONLY the raw JSON object. No markdown, no explanation, no summary, no code fences. Just the JSON starting with \`{\` and ending with \`}\`. Do not wrap it in \`\`\`json code blocks. Do not add any text before or after the JSON. The very first character of your response must be \`{\` and the very last must be \`}\`.
`);

  return parts.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// 3. Import Prompt
// ---------------------------------------------------------------------------

/**
 * Builds the prompt for analyzing an existing project directory.
 * Claude Code runs in analyze mode within the target project's directory
 * and writes the structured JSON assessment to `arji.json` at the project root.
 */
export function buildImportPrompt(
  globalPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(globalSection(globalPrompt));

  parts.push(`# Task: Analyze Existing Project

Analyze the codebase in the current directory and produce a structured assessment.

## Analysis Steps

1. **Scan the codebase**: file structure, README, package.json / pyproject.toml / Cargo.toml, CLAUDE.md, docs, tests.
2. **Generate the spec**: produce a description of the project, detected stack, and architecture.
3. **Decompose into epics and user stories**: identify existing modules/features and translate them into epics with user stories.
4. **Assign statuses**: evaluate each epic/US based on the code found.

## Rules

- An epic is "done" if the code is functional AND has tests.
- An epic is "in_progress" if code exists but is incomplete, has TODOs, or lacks tests.
- An epic is "backlog" if mentioned in docs/README/issues but not yet implemented.
- Include a confidence score (0.0 to 1.0) for each status assessment.
- Be conservative: prefer "in_progress" over "done" when uncertain.
- The \`evidence\` field should reference specific files, directories, or patterns found.

## Output

Write your analysis as a JSON file at \`./arji.json\` in the project root (the current working directory). Use the Write tool to create this file.

The JSON must have the following structure:

{
  "project": {
    "name": "detected project name",
    "description": "what this project does",
    "stack": "detected technologies",
    "architecture": "high-level architecture description"
  },
  "epics": [
    {
      "title": "Epic name",
      "description": "What this epic covers",
      "status": "done | in_progress | backlog",
      "confidence": 0.0,
      "evidence": "why this status (files, tests, TODOs found)",
      "user_stories": [
        {
          "title": "US title",
          "description": "As a... I want... so that...",
          "acceptance_criteria": "- [ ] Criterion 1",
          "status": "done | in_progress | todo",
          "evidence": "files/tests that support this status"
        }
      ]
    }
  ]
}

IMPORTANT: The file must contain only valid JSON — no markdown, no code fences, no comments. Just the raw JSON object.
`);

  return parts.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// 4. Epic Refinement Prompt
// ---------------------------------------------------------------------------

/**
 * Builds the prompt for the epic refinement chat — a back-and-forth
 * conversation where Claude helps the user define a new epic before
 * generating user stories.
 */
export function buildEpicRefinementPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  messages: PromptMessage[],
  globalPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(globalSection(globalPrompt));
  parts.push(`# Project: ${project.name}\n`);
  parts.push(section("Project Description", project.description));
  parts.push(section("Project Specification", project.spec));
  parts.push(documentsSection(documents));
  parts.push(chatHistorySection(messages));

  parts.push(`## Instructions

You are helping define a new epic for this project. Based on the conversation so far, help the user refine their idea into a well-scoped epic.

- If the description is vague or incomplete, ask 1-2 targeted clarifying questions.
- If the scope seems too large, suggest how to break it down.
- Keep your responses concise (2-4 paragraphs max).
- Reference the project's existing specification and documents when relevant.
- Do NOT generate the final epic or user stories yet — just help refine the idea.
`);

  return parts.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// 5. Epic Creation Prompt
// ---------------------------------------------------------------------------

/**
 * Builds the prompt for generating a single epic with user stories from
 * the refinement conversation. Returns structured JSON.
 */
export function buildEpicCreationPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  messages: PromptMessage[],
  globalPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(globalSection(globalPrompt));
  parts.push(`# Project: ${project.name}\n`);
  parts.push(section("Project Description", project.description));
  parts.push(section("Project Specification", project.spec));
  parts.push(documentsSection(documents));
  parts.push(chatHistorySection(messages));

  parts.push(`## Task: Generate Epic with User Stories

Based on the conversation above, generate a single epic with user stories.

## Output Format (JSON)

Return a single JSON object with the following structure:

\`\`\`json
{
  "title": "Epic title",
  "description": "Detailed description of the epic",
  "priority": 1,
  "user_stories": [
    {
      "title": "As a [role], I want [feature] so that [benefit]",
      "description": "Detailed description",
      "acceptance_criteria": "- [ ] Criterion 1\\n- [ ] Criterion 2"
    }
  ]
}
\`\`\`

## Rules

- Generate 2-8 user stories that cover the epic scope.
- User stories must follow the "As a [role], I want [feature] so that [benefit]" format.
- Acceptance criteria must be a markdown checklist.
- Priority values: 0 = low, 1 = medium, 2 = high, 3 = critical.
- Be specific and actionable — avoid vague descriptions.
- Incorporate relevant details from the project spec and reference documents.

## CRITICAL OUTPUT RULES

Your final response MUST be ONLY the raw JSON object. No markdown, no explanation, no summary, no code fences. Just the JSON starting with \`{\` and ending with \`}\`. Do not wrap it in \`\`\`json code blocks. Do not add any text before or after the JSON. The very first character of your response must be \`{\` and the very last must be \`}\`.
`);

  return parts.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------
// 6. Build Prompt
// ---------------------------------------------------------------------------

/**
 * Builds the prompt for implementing an epic with Claude Code in code mode.
 * The prompt includes the full project context, the target epic, and its
 * user stories with acceptance criteria.
 */
export function buildBuildPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  epic: PromptEpic,
  userStories: PromptUserStory[],
  globalPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(globalSection(globalPrompt));

  parts.push(`# Project: ${project.name}\n`);

  parts.push(section("Project Specification", project.spec));
  parts.push(documentsSection(documents));

  // Epic section
  parts.push(`## Epic to Implement\n`);
  parts.push(`### ${epic.title}\n`);
  if (epic.description) {
    parts.push(`${epic.description.trim()}\n`);
  }

  // User stories
  if (userStories.length > 0) {
    parts.push(`### User Stories\n`);

    const storyLines = userStories.map((us) => {
      const lines: string[] = [];
      lines.push(`- [ ] **${us.title}**`);

      if (us.description) {
        lines.push(`  ${us.description.trim()}`);
      }

      if (us.acceptanceCriteria) {
        lines.push(`  **Acceptance criteria:**`);
        // Indent each line of the acceptance criteria
        const criteria = us.acceptanceCriteria
          .trim()
          .split("\n")
          .map((line) => `  ${line}`)
          .join("\n");
        lines.push(criteria);
      }

      return lines.join("\n");
    });

    parts.push(storyLines.join("\n\n") + "\n");
  }

  parts.push(`## Instructions

Implement this epic following the specification above. For each user story:

1. Create or modify the necessary files.
2. Write tests that verify the acceptance criteria.
3. Ensure all acceptance criteria are met before moving to the next story.

Commit your changes with clear, descriptive commit messages that reference the epic and user story titles. Use conventional commit format when possible.

Work through the user stories in order. If a story depends on another, implement the dependency first.
`);

  return parts.filter(Boolean).join("\n");
}
