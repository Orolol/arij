import { finalVerdictSection } from "./shared";
import { ticketBodySection } from "./shared";
import { neutralizeControlMarkup } from "../untrusted";
/** Review prompt composition. Project memory is resolved by the public facade. */
import {
  systemSection,
  projectContextSections,
  ticketImagesSection,
  userStoriesSection,
  commentHistorySection,
  REVIEW_CHECKLISTS,
  BUG_REVIEW_CHECKLIST,
  REVIEW_BOUNDARY_SECTION,
  type PromptContextSectionKey,
  type PromptSectionCollector,
} from "../prompt-sections";
import { fenceAgentOutput } from "../untrusted";
import type {
  PromptProject,
  PromptDocument,
  PromptEpic,
  PromptUserStory,
  PromptGradingStory,
  PromptComment,
  ReviewType,
} from "./types";
import { pushPromptPart } from "./collector";

function reviewChecklist(isBug: boolean, reviewType: ReviewType): string {
  return isBug && reviewType === "feature_review" ? BUG_REVIEW_CHECKLIST : REVIEW_CHECKLISTS[reviewType];
}

/**
 * Builds the prompt for a review agent. Each review type gets a specialized
 * checklist. The agent reads and exercises the code but must not modify it
 * (REVIEW_BOUNDARY_SECTION), and posts findings as a comment.
 */
export function buildReviewPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  epic: PromptEpic,
  story: PromptUserStory,
  reviewType: ReviewType,
  systemPrompt?: string | null,
  sectionCollector?: PromptSectionCollector,
): string {
  const isBug = epic.type === "bug";
  const parts: string[] = [];
  const push = (key: PromptContextSectionKey, text: string) =>
    pushPromptPart(parts, sectionCollector, key, text);

  push("system", systemSection(systemPrompt));
  parts.push(projectContextSections(project, documents, sectionCollector, { description: false, specMaxChars: 40000, memoryMaxChars: 12000 }));

  // Epic context
  push("ticket", ticketBodySection(epic, `Epic Context`));

  push("ticket", ticketImagesSection(epic, { headingLevel: 3 }));

  // Ticket details
  push("ticket", ticketBodySection(story, isBug ? "Bug Under Review" : "Ticket Under Review"));

  if (reviewType === "feature_review") {
    // Feature review — code mode with full tool access
    push("findings", reviewChecklist(isBug, reviewType));

    push("other", `\n## Instructions

You are performing a **${isBug ? "bug fix verification" : "feature completeness review"}** on the ticket described above. You have full access to all tools — browser, shell, file system, test runners, etc.

1. Read the relevant source files to understand the implementation.
2. **Actively test the feature**: launch the app if needed, use the browser to navigate to relevant pages, run commands, execute tests.
3. Go through each acceptance criterion and verify it with concrete evidence.
4. Produce a structured report with PASS/FAIL/PARTIAL for each criterion.
5. End with a summary: number of criteria passed/failed, and an overall verdict.

${finalVerdictSection(isBug ? "bug" : "feature")}

Your response should be a well-formatted markdown report. Do NOT just read the code — actually run and test the feature.
`);
  } else {
    // Built-in review checklist
    push("findings", reviewChecklist(isBug, reviewType));

    push("other", `\n## Instructions

You are performing a **${reviewType.replace("_", " ")}** on the code changes for the ticket described above.

1. Read the relevant source files in the current working directory.
2. Evaluate the code against every item in the checklist above.
3. Produce a structured report with your findings.
4. If no issues are found for a category, state "No issues found."
5. End with a summary: total findings by severity, and an overall verdict.

${finalVerdictSection("code")}

Your response should be a well-formatted markdown report.
`);
  }

  push("other", REVIEW_BOUNDARY_SECTION);

  return parts.filter(Boolean).join("\n");
}

/**
 * Builds the grader prompt for an epic. The session spawns in code mode so
 * submit_grading — its sole deliverable, refused by plan mode as a mutating
 * MCP tool — can be called; the Role Boundary below forbids modifying the
 * repository.
 *
 * Unlike a feature/code review, grading has one narrow rubric: the user
 * stories' acceptance criteria. The durable deliverable is the
 * submit_grading call, not prose that a later stage would have to parse.
 * Dispatch skips epics without a non-empty rubric, so this builder only sees
 * stories that carry acceptance criteria.
 */
export function buildGradingPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  epic: PromptEpic,
  stories: PromptGradingStory[],
  systemPrompt?: string | null,
  sectionCollector?: PromptSectionCollector,
): string {
  const parts: string[] = [];
  const push = (key: PromptContextSectionKey, text: string) =>
    pushPromptPart(parts, sectionCollector, key, text);

  push("system", systemSection(systemPrompt));
  parts.push(projectContextSections(project, documents, sectionCollector, { description: false, specMaxChars: 40000, memoryMaxChars: 12000 }));

  push("ticket", ticketBodySection(epic, `Epic to Grade`));

  push("findings", `## Acceptance-Criteria Rubric\n`);
  for (const story of stories) {
    push("findings", `### ${neutralizeControlMarkup(story.title)}\n`);
    push("findings", `- **storyId:** \`${story.id}\`\n`);
    if (story.description) {
      push("findings", `${neutralizeControlMarkup(story.description.trim())}\n`);
    }
    push("findings", `**Acceptance criteria (verbatim):**\n`);
    push("findings", `${neutralizeControlMarkup(story.acceptanceCriteria?.trim() ?? "")}\n`);
  }

  push("other", `## Role Boundary

You are an acceptance-criteria grader, not a general code reviewer. Evaluate only whether the implementation satisfies each criterion above. Do not judge general code quality, style, architecture, or unrelated defects; those belong to review agents.

Inspect the current worktree and its diff, read the relevant implementation and tests, and run focused checks (tests, commands, the app itself) when they materially strengthen the evidence. Evidence must cite concrete files, tests, commands, or observed behavior. An implementation claim in an agent comment is not proof.

You must not modify the repository: no file edits, creates, or deletes, no commits, no branch or git-state changes. Grading only observes; if running something leaves incidental artifacts, leave them uncommitted.

## Mandatory Structured Submission

Before ending the session, you **MUST call** \`submit_grading\` exactly once. A prose report or final message is not a substitute for this tool call.

Submit this shape:

\`{ gradings: [{ storyId, criterion, status, evidence }], summary }\`

- Include exactly one grading entry for every acceptance criterion in the rubric.
- Use the exact \`storyId\` shown above and copy the corresponding criterion verbatim into \`criterion\`.
- \`status\` must be one of: \`met | partial | missed\`.
- \`evidence\` must explain the observed proof or the concrete gap; never leave it empty.
- Use \`met\` only when the criterion is fully demonstrated, \`partial\` when only part is demonstrated, and \`missed\` when it is absent or contradicted.
- Keep \`summary\` concise and outcome-focused.

Do not call \`submit_findings\`; grading does not create review findings and introduces no ticket transition. After \`submit_grading\` succeeds, briefly summarize that the structured report was filed.
`);

  return parts.filter(Boolean).join("\n");
}

/**
 * Builds the prompt for an epic-level review agent (plan mode).
 * Scoped to the entire epic and all its user stories.
 * When epic.type is "bug", adapts labels, checklist, and instructions
 * so the agent reviews a bug fix instead of a feature.
 */
export function buildEpicReviewPrompt(
  project: PromptProject,
  documents: PromptDocument[],
  epic: PromptEpic,
  userStories: PromptUserStory[],
  reviewType: ReviewType,
  systemPrompt?: string | null,
  comments?: PromptComment[],
  sectionCollector?: PromptSectionCollector,
): string {
  const isBug = epic.type === "bug";
  const parts: string[] = [];
  const push = (key: PromptContextSectionKey, text: string) =>
    pushPromptPart(parts, sectionCollector, key, text);

  push("system", systemSection(systemPrompt));
  parts.push(projectContextSections(project, documents, sectionCollector, { description: false, specMaxChars: 40000, memoryMaxChars: 12000 }));

  // Epic / Bug details — use appropriate label
  push("ticket", ticketBodySection(epic, `${isBug ? "Bug Under Review" : "Epic Under Review"}`));
  push("ticket", ticketImagesSection(epic, { headingLevel: 3 }));

  // Skip user stories section for bug tickets (they have none)
  if (!isBug) {
    push("ticket", userStoriesSection(userStories, { checkmark: false }));
  }

  // Comment history
  push("comments", commentHistorySection(comments));

  // Review checklist — bug tickets get a dedicated checklist for feature_review
  push("findings", reviewChecklist(isBug, reviewType));

  if (reviewType === "feature_review") {
    if (isBug) {
      push("other", `\n## Instructions

You are performing a **bug fix verification** on the bug described above. You have full access to all tools — browser, shell, file system, test runners, etc.

**IMPORTANT: This is a BUG FIX review, not a feature review.** Focus exclusively on verifying the bug fix described in this ticket. Do NOT review unrelated features or changes from other tickets.

1. Read the bug description and understand the reported issue.
2. Read the relevant source files to understand the fix.
3. **Actively test the fix**: launch the app if needed, use the browser, run commands, execute tests.
4. Verify the fix addresses the root cause, not just the symptom.
5. Check for regressions in adjacent functionality.
6. Produce a structured report with PASS/FAIL/PARTIAL for each verification criterion.

${finalVerdictSection("bug")}

Your response should be a well-formatted markdown report. Do NOT just read the code — actually run and test the fix.
`);
    } else {
      push("other", `\n## Instructions

You are performing a **feature completeness review** on the entire epic described above, covering all user stories. You have full access to all tools — browser, shell, file system, test runners, etc.

1. Read the relevant source files to understand the implementation.
2. **Actively test the features**: launch the app if needed, use the browser to navigate to relevant pages, run commands, execute tests.
3. Go through each user story and its acceptance criteria, verifying with concrete evidence.
4. Produce a structured report with PASS/FAIL/PARTIAL for each user story and criterion.
5. End with a summary: number of stories/criteria passed/failed, and an overall verdict.

${finalVerdictSection(isBug ? "bug" : "feature")}

Your response should be a well-formatted markdown report. Do NOT just read the code — actually run and test the features.
`);
    }
  } else {
    const reviewLabel = isBug
      ? `${reviewType.replace("_", " ")} (bug fix)`
      : reviewType.replace("_", " ");
    push("other", `\n## Instructions

You are performing a **${reviewLabel}** on the ${isBug ? "bug fix" : "entire epic"} described above${isBug ? "" : ", covering all user stories"}.

${isBug ? "**IMPORTANT: This is a BUG FIX review.** Focus exclusively on the bug fix described in this ticket. Do NOT review unrelated features or changes from other tickets.\n" : ""}1. Read the relevant source files in the current working directory.
2. Evaluate the code against every item in the checklist above.
3. Produce a structured report with your findings.
4. If no issues are found for a category, state "No issues found."
5. End with a summary: total findings by severity, and an overall verdict.

${finalVerdictSection("code")}

Your response should be a well-formatted markdown report.
`);
  }

  push("other", REVIEW_BOUNDARY_SECTION);

  return parts.filter(Boolean).join("\n");
}

/**
 * Short, read-only review of the final epic diff. Unlike the normal review
 * prompt this is a merge gate, not another broad QA pass: it asks an
 * independent provider to look only for reasons the already-reviewed branch
 * must not land and requires the structured MCP verdict the supervisor reads.
 */
export function buildSecondOpinionPrompt(
  project: PromptProject,
  epic: PromptEpic,
  userStories: PromptUserStory[],
  branchName: string,
  baseBranch: string,
  finalDiff?: string,
  structuredToolsAvailable = true
): string {
  const parts: string[] = [];

  parts.push(projectContextSections(project, [], undefined, { specMaxChars: 40000, memoryMaxChars: 12000 }));
  parts.push(ticketBodySection(epic, "Epic Awaiting Merge"));
  if (epic.type !== "bug") {
    parts.push(userStoriesSection(userStories, { checkmark: false }));
  }

  // The diff is the *build agent's own committed work*: every source file,
  // test fixture and comment on the branch reaches this gate verbatim, and
  // this gate is the last thing between Full Auto and the base branch. So it
  // gets the evidence-channel treatment — neutralised, and fenced with a run
  // longer than anything it contains. A bare ```diff fence is closed by the
  // first Markdown file the branch touches, and everything after it reads as
  // prompt rather than as diff.
  const trimmedDiff = finalDiff?.trim();

  parts.push(`## Independent Second Opinion

Branch: \`${branchName}\`
Base branch: \`${baseBranch}\`

This epic already passed its normal review. Perform one short, independent,
read-only pass over the **final branch diff** before Full Auto merges it.

The exact output of \`git diff ${baseBranch}...HEAD\` is embedded below. Read
only the surrounding code needed to validate it; do not edit files.

${trimmedDiff ? fenceAgentOutput(trimmedDiff, "diff") : "(no committed diff)"}

1. Inspect the embedded final diff and read only the surrounding code needed to validate it.
2. Look only for merge-blocking defects: correctness regressions, security issues, destructive behaviour, or an acceptance criterion that the diff plainly does not implement. Do not restyle working code and do not edit files.
${
  structuredToolsAvailable
    ? "3. Call `submit_findings` exactly once. Use `changes_requested` and file/line-anchored `critical` or `major` findings for any blocker. Otherwise use `approved` (or `approved_with_minor_issues`) with an empty findings array; keep non-blocking suggestions in the summary — changes_requested or an open critical/major finding blocks the merge; minor/info findings do not. The structured submission is authoritative."
    : "3. This provider has no structured Arij findings channel. Put any blocker, with file and line, in the response and make the exact Overall Verdict line below authoritative."
}
4. End your response with exactly one of these lines:
   - \`**Overall Verdict: Approved**\`
   - \`**Overall Verdict: Approved with Minor Issues**\`
   - \`**Overall Verdict: Changes Requested**\`

A missing structured submission and missing Overall Verdict line is a failed gate, and the branch will not merge.`);

  return parts.filter(Boolean).join("\n");
}
