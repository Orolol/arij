import { projectContextSections } from "../prompt-sections";
import { additionalInstructionsSection } from "./shared";
/** Qa prompt composition. Project memory is resolved by the public facade. */
import { systemSection } from "../prompt-sections";
import type { TelescopeCollectionResult } from "@/lib/telescope/collect";
import { fenceAgentOutput } from "../untrusted";
import type { PromptProject } from "./types";

/**
 * Builds the prompt for a comprehensive project tech check (QA).
 */
export function buildTechCheckPrompt(
  project: PromptProject,
  customPrompt?: string | null,
  systemPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));
  parts.push(projectContextSections(project, [], undefined, { description: false, specMaxChars: 40000, memoryMaxChars: 12000 }));

  if (customPrompt && customPrompt.trim()) {
    parts.push(additionalInstructionsSection(customPrompt));
  }

  parts.push(`## Task: Comprehensive Tech Check

Perform a thorough technical review of the entire project codebase. This is a full code health audit, not scoped to a single epic or ticket.

### Review Areas

1. **Architecture & Patterns**
   - Overall architecture quality and consistency
   - Design pattern usage and appropriateness
   - Separation of concerns
   - Module boundaries and dependencies

2. **Code Quality**
   - Code readability and naming conventions
   - DRY violations and code duplication
   - Dead code and unused imports
   - Error handling patterns
   - Type safety and proper TypeScript usage

3. **Performance**
   - Obvious performance bottlenecks
   - Database query patterns (N+1, missing indexes)
   - Frontend rendering inefficiencies
   - Bundle size concerns

4. **Security**
   - Input validation gaps
   - Authentication/authorization issues
   - Secrets exposure risks
   - Dependency vulnerabilities

5. **Testing**
   - Test coverage gaps
   - Test quality and maintainability
   - Missing edge case coverage

6. **Technical Debt**
   - TODOs and FIXMEs in code
   - Outdated dependencies
   - Deprecated API usage
   - Migration/upgrade needs

### Output Format

Produce a detailed markdown report with:
- An executive summary (2-3 paragraphs)
- Findings organized by the categories above
- Each finding should include: severity (Critical/High/Medium/Low), file location, description, and recommendation
- A prioritized action items list at the end, suitable for creating epics

Your response should be a well-formatted markdown report.
`);

  return parts.filter(Boolean).join("\n");
}

/**
 * Builds the prompt for a comprehensive end-to-end test run (QA).
 */
export function buildE2eTestPrompt(
  project: PromptProject,
  customPrompt?: string | null,
  systemPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));
  parts.push(projectContextSections(project, [], undefined, { description: false, specMaxChars: 40000, memoryMaxChars: 12000 }));

  if (customPrompt && customPrompt.trim()) {
    parts.push(additionalInstructionsSection(customPrompt));
  }

  parts.push(`## Task: Comprehensive E2E Test

Perform thorough end-to-end testing of the entire application. Use browser automation, test runners, and HTTP clients to verify all features work correctly from the user's perspective.

### Testing Areas

1. **Core User Flows**
   - Authentication and authorization flows
   - Primary CRUD operations
   - Multi-step workflows end-to-end
   - Form submissions and validations
   - File uploads and processing

2. **API & Data Integrity**
   - API endpoints return correct responses
   - Data persistence across operations
   - Error responses for invalid inputs
   - Pagination, filtering, and sorting
   - Concurrent operation handling

3. **UI & Interaction**
   - Interactive components respond correctly (buttons, dialogs, dropdowns)
   - Drag-and-drop functionality
   - Keyboard navigation and shortcuts
   - Responsive layout across breakpoints
   - Loading states and transitions

4. **Navigation & Routing**
   - All routes load without errors
   - Deep linking and URL parameters
   - Back/forward browser navigation
   - Redirect flows work correctly
   - 404 and error pages display properly

5. **Integration Points**
   - Third-party service integrations
   - WebSocket or real-time connections
   - Background job triggers and results
   - Notification delivery
   - External API callbacks

6. **Regression Checks**
   - Previously fixed bugs remain resolved
   - Feature interactions don't break each other
   - Data migrations haven't corrupted state
   - Performance hasn't degraded noticeably
   - Edge cases and boundary conditions

### Output Format

Produce a detailed markdown report with:
- An executive summary (2-3 paragraphs)
- Test results organized by the categories above
- Each test should include: status (PASS/FAIL/SKIP), test description, steps performed, and details on failures
- A summary table at the end with total PASS/FAIL/SKIP counts
- A prioritized list of failures and recommended fixes

Your response should be a well-formatted markdown report.
`);

  return parts.filter(Boolean).join("\n");
}

/**
 * Builds the project-level, read-only Telescope-lite analysis prompt.
 *
 * The collector has already selected, normalized, grouped, and capped the
 * evidence. Keeping that boundary explicit prevents the agent from receiving
 * unbounded raw logs or quietly redefining which incidents belong together.
 *
 * The grouped payload still carries session messages, errors and chunk
 * excerpts verbatim, and `JSON.stringify` is weaker cover than it looks: it
 * escapes quotes, backslashes and newlines, but not angle brackets, so
 * `<system-directive>` reaches the prompt intact inside a string value. The
 * serialized payload therefore goes through `fenceAgentOutput` like every
 * other evidence block — the ```json label survives, the fence grows past any
 * backtick run in the payload, and the tags come out escaped.
 */
export function buildFailureDigestPrompt(
  project: PromptProject,
  collection: TelescopeCollectionResult,
  customPrompt?: string | null,
  systemPrompt?: string | null,
): string {
  const parts: string[] = [];

  parts.push(systemSection(systemPrompt));
  parts.push(projectContextSections(project, [], undefined, { description: false, specMaxChars: 40000, memoryMaxChars: 12000 }));

  if (customPrompt && customPrompt.trim()) {
    parts.push(additionalInstructionsSection(customPrompt));
  }

  parts.push(`## Task: Recurring Failure Digest

You are running in plan mode. Analyze the mechanically pre-grouped failure
evidence below and produce a concise markdown report. Do not modify the
repository, run fixes, or create tickets. The mechanical signatures and their
frequencies are evidence: do not merge unrelated signatures or invent events
that are absent from the payload.

### Collection Window

- From: ${collection.sinceIso}
- Through: ${collection.untilIso}
- Window: ${collection.windowDays} days
- Evidence rows: ${collection.evidenceCount}
- Mechanical groups before payload limits: ${collection.groupCount}
- Groups included: ${collection.groups.length}
- Groups omitted by limits: ${collection.omittedGroupCount}
- Payload truncated: ${collection.truncated ? "yes" : "no"}

### Mechanically Grouped Evidence

${fenceAgentOutput(JSON.stringify(collection.groups, null, 2), "json")}

### Required Report Format

Start with a short executive summary. Then write one section per meaningful
cluster, ordered by urgency and frequency. Every cluster section must include:

- a specific, human-readable cluster name;
- the exact observed frequency and source breakdown;
- the affected ticket IDs (or explicitly state that none were attached);
- the provider and agent type dimensions;
- an evidence-based root-cause hypothesis, clearly labelled as a hypothesis;
- a concrete proposed remediation and a way to verify it.

Close with a prioritized remediation list. Distinguish observed facts from
inference, preserve uncertainty, and mention omitted/truncated evidence when it
limits confidence.

Your ENTIRE response must be only the markdown report. Do not wrap it in a
code fence and do not add commentary before or after it.
`);

  return parts.filter(Boolean).join("\n");
}
