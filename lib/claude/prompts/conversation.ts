/** Conversation prompt composition. Project memory is resolved by the public facade. */
import {
  systemSection,
  existingEpicsSection,
  chatHistorySection,
  projectContextSections,
} from "../prompt-sections";
import type { PromptProject, PromptDocument, PromptMessage, PromptEpic } from "./types";

/**
 * Builds the prompt for the brainstorm chat panel.
 * Claude Code runs in plan mode to discuss ideas and refine the project.
 */
export function buildChatPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  messages: PromptMessage[],
  systemPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));
  parts.push(projectContextSections(project, documents));
  parts.push(chatHistorySection(messages));

  parts.push(`## Instructions

You are helping brainstorm and refine this project. Answer the user's latest message considering the full project context above. Be specific, actionable, and reference the project's existing specification and documents when relevant.

If the user asks about architecture, features, or implementation details, provide concrete suggestions grounded in the project's context.
`);

  return parts.filter(Boolean).join("\n");
}

/**
 * Builds the prompt for analyzing an existing project directory.
 * The configured provider runs in analyze mode within the target project's
 * directory and writes the structured JSON assessment to `arji.json` at the
 * project root.
 */
export function buildImportPrompt(systemPrompt?: string | null): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));

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

/**
 * Builds the prompt for the epic refinement chat — a back-and-forth
 * conversation where Claude helps the user define a new epic before
 * generating user stories.
 */
export function buildEpicRefinementPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  messages: PromptMessage[],
  systemPrompt?: string | null,
  existingEpics: PromptEpic[] = [],
): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));
  parts.push(projectContextSections(project, documents));
  parts.push(existingEpicsSection(existingEpics));
  parts.push(chatHistorySection(messages));

  parts.push(`## Instructions

You are helping define a new epic for this project. Based on the conversation so far, help the user refine their idea into a well-scoped epic.

- If the description is vague or incomplete, ask 1-2 targeted clarifying questions.
- If the scope seems too large, suggest how to break it down.
- Guide the user toward a concrete epic title, epic description, user stories, and acceptance criteria.
- Use the existing epics list above to avoid overlap and suggest clear differentiation.
- Keep your responses concise (2-4 paragraphs max).
- Reference the project's existing specification and documents when relevant.
- Do NOT generate the final epic or user stories yet — just help refine the idea.
`);

  return parts.filter(Boolean).join("\n");
}

/**
 * Builds the prompt that asks the AI to output the final structured epic
 * with user stories as JSON, based on the refinement conversation so far.
 */
export function buildEpicFinalizationPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  messages: PromptMessage[],
  systemPrompt?: string | null,
  existingEpics: PromptEpic[] = [],
): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));
  parts.push(projectContextSections(project, documents));
  parts.push(existingEpicsSection(existingEpics));
  parts.push(chatHistorySection(messages));

  parts.push(`## Task

Output the epic and user stories from the conversation above as a MACHINE-PARSEABLE JSON code block.

## Rules
- The title should be concise and descriptive.
- The description should include a detailed implementation plan.
- Generate 2-8 user stories that fully cover the epic scope.
- User stories must follow the "As a [role], I want [feature] so that [benefit]" format.
- Acceptance criteria must be a markdown checklist.
- Be specific and actionable — avoid vague descriptions.
- Incorporate relevant details from the project spec and reference documents.
- If this epic depends on existing epics (listed above), include dependency edges in the "dependencies" array. Use "$self" for the current epic's ID. Only reference epics from the same project. If there are no dependencies, omit the "dependencies" field or use an empty array.

## CRITICAL OUTPUT FORMAT — YOU MUST FOLLOW THIS EXACTLY

Your ENTIRE response must be a single fenced JSON code block. Nothing else.

\`\`\`json
{
  "title": "Epic title",
  "description": "Detailed epic description including implementation plan",
  "userStories": [
    {
      "title": "As a [role], I want [feature] so that [benefit]",
      "description": "Detailed description of the user story",
      "acceptanceCriteria": "- [ ] Criterion 1\\n- [ ] Criterion 2"
    }
  ],
  "dependencies": []
}
\`\`\`

ABSOLUTE REQUIREMENTS:
- The very first characters of your response MUST be \`\`\`json
- The very last characters of your response MUST be \`\`\`
- Output EXACTLY ONE epic object. Never output an array, and never wrap it in an "epics" key — if the discussion covers several epics, pick the single most important one and fold the rest into its user stories.
- Do NOT write any text before or after the JSON code block.
- Do NOT say "The plan is ready", "Here's the epic", or any summary/preamble.
- Do NOT ask for confirmation or approval — just output the JSON.
- If you include ANY text outside the code fence, the automated parser will FAIL and the epic will not be created.
`);

  return parts.filter(Boolean).join("\n");
}

/**
 * Builds a lightweight prompt for generating a 2-4 word conversation title.
 */
export function buildTitleGenerationPrompt(
  firstUserMessage: string,
  firstAssistantResponse: string,
  systemPrompt?: string | null,
): string {
  const trimmedResponse = firstAssistantResponse.slice(0, 500);
  const taskPrompt = [
    "Generate a concise 2-4 word title for this conversation. Return ONLY the title text, nothing else.",
    "",
    `User: ${firstUserMessage}`,
    "",
    `Assistant: ${trimmedResponse}`,
  ].join("\n");
  return [systemSection(systemPrompt), taskPrompt].filter(Boolean).join("\n");
}
