import { handleAskedQuestionOutcome } from "@/lib/workflow/agent-question";
/**
 * Acceptance-criteria grader dispatch.
 *
 * Grading is intentionally observational: it creates a plan-mode session and
 * a grading report, but never changes epic/story status. Epics without a
 * usable rubric are a successful, journalled no-op.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  epics,
  gradingReports,
  projects,
  userStories,
} from "@/lib/db/schema";
import { createWorktree, isGitRepo } from "@/lib/git/manager";
import { assembleGradingPrompt } from "@/lib/tokens";
import {
  resolveAgentForDispatch,
  type ResolvedAgent,
} from "@/lib/agent-config/agent-resolution";
import { dispatchBackgroundSession } from "@/lib/agent-sessions/dispatch-background-session";
import {
  createAgentAlreadyRunningPayload,
  getRunningSessionForTarget,
  type AgentAlreadyRunningPayload,
} from "@/lib/agents/concurrency";
import { logTransition } from "@/lib/workflow/log";
import {
  emitSessionCompleted,
  emitSessionFailed,
  emitSessionStarted,
} from "@/lib/events/emit";

export const GRADING_AGENT_TYPE = "grading" as const;

export const GRADING_NO_STORIES_REASON =
  "Grading skipped — this epic has no user stories.";
export const GRADING_NO_CRITERIA_REASON =
  "Grading skipped — no user story has acceptance criteria.";

const GRADING_MISSING_REPORT_ERROR =
  "The grading agent finished without calling submit_grading; no structured grading report was saved.";

type ProjectRow = typeof projects.$inferSelect;
type EpicRow = typeof epics.$inferSelect;
type StoryRow = typeof userStories.$inferSelect;

export interface GradingSessionResult {
  sessionId: string;
  success: boolean;
  outcome: string | null;
  error: string | null;
  reportId: string | null;
}

export type DispatchGradingResult =
  | {
      skipped: true;
      reason: string;
    }
  | {
      skipped: false;
      sessionId: string;
      provider: string;
      segregated: boolean;
      builderProvider: string | null;
      settled: Promise<GradingSessionResult>;
    };

/** Error with the HTTP response contract the thin route should expose. */
export class GradingDispatchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly payload?: AgentAlreadyRunningPayload,
  ) {
    super(message);
    this.name = "GradingDispatchError";
  }
}

export interface DispatchGradingInput {
  projectId: string;
  epicId: string;
  /** Pipeline story runs grade only their own rubric; manual runs grade the epic. */
  userStoryId?: string | null;
  namedAgentId?: string | null;
  batchRunId?: string | null;
  /** Pipeline-owned ranked resolution; deferred so rubric-free runs still skip. */
  resolveAgent?: () => Promise<ResolvedAgent>;
}

/** Non-empty criteria are the rubric; stories without criteria are omitted. */
export function gradableStories(stories: StoryRow[]): StoryRow[] {
  return stories.filter(
    (story) =>
      typeof story.acceptanceCriteria === "string" &&
      story.acceptanceCriteria.trim().length > 0,
  );
}

function gradingSkipReason(stories: StoryRow[]): string | null {
  if (stories.length === 0) return GRADING_NO_STORIES_REASON;
  if (gradableStories(stories).length === 0) return GRADING_NO_CRITERIA_REASON;
  return null;
}

function journalSkip(projectId: string, epic: EpicRow, reason: string): void {
  const status = epic.status ?? "backlog";
  logTransition({
    projectId,
    epicId: epic.id,
    fromStatus: status,
    toStatus: status,
    actor: "system",
    reason,
  });
}

function loadScope(input: DispatchGradingInput): {
  project: ProjectRow;
  epic: EpicRow;
  stories: StoryRow[];
} {
  const project = db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get();
  if (!project) {
    throw new GradingDispatchError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const epic = db
    .select()
    .from(epics)
    .where(and(eq(epics.id, input.epicId), eq(epics.projectId, input.projectId)))
    .get();
  if (!epic) {
    throw new GradingDispatchError("Epic not found", 404, "EPIC_NOT_FOUND");
  }

  const stories = db
    .select()
    .from(userStories)
    .where(eq(userStories.epicId, input.epicId))
    .orderBy(userStories.position)
    .all();

  return { project, epic, stories };
}

/**
 * Creates and schedules one epic-scoped grader session, or returns the
 * journalled no-op without touching Git/session state.
 */
export async function dispatchGradingSession(
  input: DispatchGradingInput,
): Promise<DispatchGradingResult> {
  const { project, epic, stories } = loadScope(input);
  const scopedStories = input.userStoryId
    ? stories.filter((story) => story.id === input.userStoryId)
    : stories;
  if (input.userStoryId && scopedStories.length === 0) {
    throw new GradingDispatchError(
      "Story not found in this epic",
      404,
      "STORY_NOT_FOUND",
    );
  }
  const skipReason = gradingSkipReason(scopedStories);
  if (skipReason) {
    journalSkip(input.projectId, epic, skipReason);
    return { skipped: true, reason: skipReason };
  }

  const gradingTarget = input.userStoryId ? scopedStories[0] : epic;
  if (gradingTarget.status !== "review" && gradingTarget.status !== "done") {
    throw new GradingDispatchError(
      `${input.userStoryId ? "Story" : "Epic"} must be in review or done status for acceptance grading`,
      400,
      input.userStoryId ? "INVALID_STORY_STATUS" : "INVALID_EPIC_STATUS",
    );
  }

  const target = input.userStoryId
    ? {
        scope: "story" as const,
        projectId: input.projectId,
        storyId: input.userStoryId,
        epicId: input.epicId,
      }
    : {
        scope: "epic" as const,
        projectId: input.projectId,
        epicId: input.epicId,
      };
  const conflict = getRunningSessionForTarget(target);
  if (conflict) {
    const payload = createAgentAlreadyRunningPayload(
      target,
      conflict,
      "Another agent is already running for this epic.",
    );
    throw new GradingDispatchError(payload.error, 409, payload.code, payload);
  }

  if (!project.gitRepoPath) {
    throw new GradingDispatchError(
      "Project has no git repository path configured",
      400,
      "MISSING_GIT_REPOSITORY",
    );
  }
  if (!(await isGitRepo(project.gitRepoPath))) {
    throw new GradingDispatchError(
      `Path is not a git repository: ${project.gitRepoPath}`,
      400,
      "INVALID_GIT_REPOSITORY",
    );
  }

  const rubric = gradableStories(scopedStories);
  const assembled = await assembleGradingPrompt({
    projectId: input.projectId,
    epicId: input.epicId,
    project,
    epic,
    stories: rubric,
  });
  const prompt = assembled.prompt;
  const resolvedAgent = await (input.resolveAgent?.() ?? resolveAgentForDispatch(
    GRADING_AGENT_TYPE,
    input.projectId,
    input.namedAgentId ?? null,
    {
      purpose: "grading",
      projectId: input.projectId,
      epicId: input.epicId,
      ...(input.userStoryId ? { storyId: input.userStoryId } : {}),
    },
  ));

  const { worktreePath, branchName } = await createWorktree(
    project.gitRepoPath,
    epic.id,
    epic.title,
    { defaultBranch: project.defaultBranch },
  );

  // A grading run succeeded only if a report row exists: the agent must have
  // called submit_grading, not merely exited zero. Decided in `evaluate`, so
  // the verdict written to the session row says the same as the result.
  let reportId: string | null = null;

  const dispatched = dispatchBackgroundSession({
    agentType: GRADING_AGENT_TYPE,
    projectId: input.projectId,
    // Ticket-scoped on purpose: a grader occupies the epic (or story) the way
    // a review does, so the concurrency guards keep a second agent off it.
    epicId: input.epicId,
    userStoryId: input.userStoryId ?? null,
    prompt,
    resolvedAgent,
    mode: "code",
    cwd: worktreePath,
    logPrefix: "[grading]",
    session: {
      estimatedPromptTokens: assembled.tokens.total,
      estimatedPromptBreakdown: JSON.stringify(assembled.tokens.breakdown),
      branchName,
      worktreePath,
      batchRunId: input.batchRunId ?? null,
    },
    onQueued: ({ sessionId }) => {
      emitSessionStarted(
        input.projectId,
        input.epicId,
        sessionId,
        GRADING_AGENT_TYPE,
      );
    },
    evaluate: ({ sessionId, result }) => {
      const report = db
        .select({ id: gradingReports.id })
        .from(gradingReports)
        .where(eq(gradingReports.agentSessionId, sessionId))
        .orderBy(desc(gradingReports.createdAt))
        .limit(1)
        .get();
      reportId = report?.id ?? null;
      const success = Boolean(result?.success && report);
      const error = success
        ? null
        : result?.error ??
          (result?.success
            ? GRADING_MISSING_REPORT_ERROR
            : "The grading session failed without reporting an error.");
      return { success, error };
    },
    onTerminal: ({ sessionId, success, error, outcome }) => {
      if (outcome === "asked_question") {
        handleAskedQuestionOutcome({ projectId: input.projectId, epicIds: [input.epicId], sessionId, ticketStatus: epic.status ?? "review" });
      }
      if (success) {
        emitSessionCompleted(input.projectId, input.epicId, sessionId);
      } else {
        emitSessionFailed(
          input.projectId,
          input.epicId,
          sessionId,
          error ?? "Acceptance grading failed",
        );
      }
    },
  });

  const settled: Promise<GradingSessionResult> = dispatched.settled.then(
    (run) =>
      run.launchError
        ? {
            sessionId: run.sessionId,
            success: false,
            outcome: "error",
            error:
              run.launchError instanceof Error
                ? run.launchError.message
                : "Grading launch failed",
            reportId: null,
          }
        : {
            sessionId: run.sessionId,
            success: run.success,
            outcome: run.outcome,
            error: run.error,
            reportId,
          },
  );

  return {
    skipped: false,
    sessionId: dispatched.sessionId,
    provider: dispatched.provider,
    segregated: resolvedAgent.segregated === true,
    builderProvider: resolvedAgent.builderProvider ?? null,
    settled,
  };
}
