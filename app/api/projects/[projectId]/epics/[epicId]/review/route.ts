import { resolveAgentForDispatch } from "@/lib/agent-config/agent-resolution";
import { REVIEW_LABELS, REVIEW_TYPE_TO_AGENT_TYPE, VALID_REVIEW_TYPES } from "@/lib/agent-config/constants";
import { mintAssignedCliSessionId } from "@/lib/agent-sessions/dispatch-background-session";
import { dispatchReviewSession } from "@/lib/agent-sessions/dispatch-ticket-session";
import { createSessionLogsPath } from "@/lib/agent-sessions/session-paths";
import { validateResumeSession } from "@/lib/agent-sessions/validate-resume";
import {
  createAgentAlreadyRunningPayload,
  getRunningSessionForTarget,
} from "@/lib/agents/concurrency";
import { withAgentResolutionErrors } from "@/lib/api/agent-resolution-response";
import {
  getEpicOr404,
  getProjectOr404,
  isErrorResponse,
} from "@/lib/api/route-helpers";
import { type ReviewType } from "@/lib/claude/prompt-builder";
import { loadPromptComments } from "@/lib/claude/prompt-comments";
import {
  resolveSessionOutput
} from "@/lib/claude/resolve-session-output";
import { db } from "@/lib/db";
import {
  epics,
  ticketComments,
  userStories,
} from "@/lib/db/schema";
import { createWorktree, isGitRepo } from "@/lib/git/manager";
import {
  collectBlockingFindings,
  readSessionFindingsWindow,
  resolvePriorFindingsFromProse,
  resolveReviewVerdict,
} from "@/lib/pipeline/findings";
import { assembleEpicReviewPrompt } from "@/lib/tokens";
import { createId } from "@/lib/utils/nanoid";
import { handleAskedQuestionOutcome } from "@/lib/workflow/agent-question";
import {
  transitionReviewPassed,
  transitionReviewRejected,
} from "@/lib/workflow/automatic-transitions";
import { postUnresolvedMentionsComment } from "@/lib/workflow/system-comment";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ projectId: string; epicId: string }> };

export const POST = withAgentResolutionErrors(async function POST(request: NextRequest, { params }: Params) {
  const { projectId, epicId } = await params;
  const body = await request.json().catch(() => ({}));

  const { reviewTypes, namedAgentId: namedAgentIdParam, resumeSessionId: resumeSessionIdParam } = body as {
    reviewTypes: ReviewType[];
    namedAgentId?: string | null;
    resumeSessionId?: string;
  };
  const namedAgentId: string | null = namedAgentIdParam || null;

  if (!reviewTypes || !Array.isArray(reviewTypes) || reviewTypes.length === 0) {
    return NextResponse.json(
      { error: "reviewTypes array is required with at least one type" },
      { status: 400 }
    );
  }

  for (const rt of reviewTypes) {
    if (!VALID_REVIEW_TYPES.includes(rt)) {
      return NextResponse.json(
        { error: `Invalid review type: ${rt}. Valid types: ${VALID_REVIEW_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // Validate epic in review status (project-scoped lookup)
  const foundEpic = getEpicOr404(projectId, epicId);
  if (isErrorResponse(foundEpic)) return foundEpic;
  const { epic } = foundEpic;
  if (
    epic.status !== "review" &&
    epic.status !== "to_merge" &&
    epic.status !== "done"
  ) {
    return NextResponse.json(
      { error: "Epic must be in review, to merge or done status for agent review" },
      { status: 400 }
    );
  }

  // Concurrency guard — one active agent per epic
  const conflict = getRunningSessionForTarget({
    scope: "epic",
    projectId,
    epicId,
  });
  if (conflict) {
    return NextResponse.json(
      createAgentAlreadyRunningPayload(
        { scope: "epic", projectId, epicId },
        conflict,
        "Another agent is already running for this epic."
      ),
      { status: 409 }
    );
  }

  // Get project
  const foundProject = getProjectOr404(projectId, { requireGitRepo: true });
  if (isErrorResponse(foundProject)) return foundProject;
  const { project } = foundProject;

  const gitRepoPath = project.gitRepoPath;
  const isRepo = await isGitRepo(gitRepoPath);
  if (!isRepo) {
    return NextResponse.json(
      { error: `Path is not a git repository: ${gitRepoPath}` },
      { status: 400 }
    );
  }

  // Load context
  const us = db
    .select()
    .from(userStories)
    .where(eq(userStories.epicId, epicId))
    .orderBy(userStories.position)
    .all();

  // Load epic comments
  const promptComments = loadPromptComments({ epicId });

  // Ensure worktree exists
  const { worktreePath, branchName } = await createWorktree(
    gitRepoPath,
    epic.id,
    epic.title,
    { defaultBranch: project.defaultBranch }
  );

  const sessionsCreated: string[] = [];
  const resolutions: Array<{
    sessionId: string;
    reviewType: ReviewType;
    provider: string;
    segregated: boolean;
    builderProvider: string | null;
  }> = [];

  for (const [idx, reviewType] of reviewTypes.entries()) {
    const assembled = await assembleEpicReviewPrompt({
      projectId,
      epicId,
      project,
      epic,
      reviewType,
      stories: us,
      comments: promptComments,
    });
    const enrichedPrompt = assembled.prompt;
    postUnresolvedMentionsComment({ epicId, missing: assembled.missingDocuments, agentType: REVIEW_TYPE_TO_AGENT_TYPE[reviewType] });
    const resolvedAgent = await resolveAgentForDispatch(
      REVIEW_TYPE_TO_AGENT_TYPE[reviewType],
      projectId,
      namedAgentId,
      { purpose: "review", projectId, epicId }
    );

    const sessionId = createId();
    const now = new Date().toISOString();
    const logsPath = createSessionLogsPath(sessionId);

    // All review types run in code mode: plan mode refuses mutating MCP
    // tools (submit_findings, create_bug) and read-only provider postures
    // cut the tool channel. The reviewer's no-modification rule is a prompt
    // contract (REVIEW_BOUNDARY_SECTION), not a harness restriction.
    const agentMode = "code";

    // First review session can resume; subsequent ones start fresh. Resolved
    // per review type because each one may land on a different provider, and
    // the stored id is only valid for the provider that created it.
    const resumeCliSessionId =
      idx === 0 && resumeSessionIdParam
        ? validateResumeSession({
            resumeSessionId: resumeSessionIdParam,
            epicId: epicId,
            expectedProvider: resolvedAgent.provider,
          })?.cliSessionId
        : undefined;

    const useResume = !!resumeCliSessionId;
    const cliSessionId = useResume
      ? resumeCliSessionId
      : mintAssignedCliSessionId(resolvedAgent.provider);

    const row = {
      id: sessionId,
      projectId,
      epicId,
      mode: agentMode,
      provider: resolvedAgent.provider,
      prompt: enrichedPrompt,
      estimatedPromptTokens: assembled.tokens.total,
      estimatedPromptBreakdown: JSON.stringify(assembled.tokens.breakdown),
      logsPath,
      branchName,
      worktreePath,
      cliSessionId,
      namedAgentId: resolvedAgent.namedAgentId ?? null,
      compositeAgentId: resolvedAgent.compositeAgentId ?? null,
      agentType: REVIEW_TYPE_TO_AGENT_TYPE[reviewType],
      namedAgentName: resolvedAgent.name || null,
      model: resolvedAgent.model || null,
      createdAt: now,
    };


    const sid = sessionId;
    const lbl = REVIEW_LABELS[reviewType];
    dispatchReviewSession({ row, resolvedAgent, resumeSession: useResume,
      onTerminal: ({ result, outcome, completedAt }) => {
        const output = resolveSessionOutput(result, sid, "Review agent completed without output.");

        db.insert(ticketComments)
          .values({
            id: createId(),
            epicId,
            author: "agent",
            content: `**${lbl}**\n\n${output}`,
            agentSessionId: sid,
            createdAt: completedAt,
          })
          .run();

        // asked_question guard: the reviewer stopped to ask the user
        // something, so its output is not a verdict — hold the ticket where
        // it is, notify, log the decision, and skip verdict handling.
        const askedQuestion = outcome === "asked_question";
        if (askedQuestion) {
          handleAskedQuestionOutcome({
            projectId,
            epicIds: [epicId],
            sessionId: sid,
            ticketStatus: epic.status ?? "review",
          });
        }

        // If the review verdict indicates work is not done, revert epic and
        // user stories back to in_progress. Channels in priority order: the
        // reviewer's persisted submit_findings verdict, else the prose scan of
        // its final message (lib/pipeline/findings.ts owns the priority; a
        // reviewer on a provider without MCP only ever produces the prose one).
        // Prose fallback of submit_findings.prior_findings: [RC:id] FIXED
        // lines in the report resolve the prior findings they name.
        if (!askedQuestion) {
          resolvePriorFindingsFromProse({ epicId, sessionOutput: output });
        }

        const decision = askedQuestion
          ? null
          : resolveReviewVerdict({
              epicId,
              reviewSessionId: sid,
              sessionOutput: output,
            });

        if (decision?.negative) {
          const currentEpic = db
            .select()
            .from(epics)
            .where(eq(epics.id, epicId))
            .get();

          if (
            currentEpic &&
            (currentEpic.status === "done" ||
              currentEpic.status === "review" ||
              currentEpic.status === "to_merge")
          ) {
            transitionReviewRejected({
              projectId,
              epicId,
              scope: "epic",
              reason: `Review verdict: changes requested (${lbl})`,
              sessionId: sid,
              verdictSource: decision.source,
            });
          }
        } else if (decision && !decision.unverifiable && result?.success) {
          // Review passed: promote to the merge boundary — unless the session
          // filed an open blocking finding in its window while its verdict
          // came from prose (resolveReviewVerdict ignores findings on that
          // path); promoting then would show To Merge with an open critical.
          const findingsWindow = readSessionFindingsWindow(sid);
          const blockingInWindow = findingsWindow
            ? collectBlockingFindings(epicId, findingsWindow)
            : [];
          if (blockingInWindow.length === 0) {
            // transitionReviewPassed itself no-ops (with a decision line)
            // when the ticket already left review — e.g. a concurrent move
            // while the reviewer ran.
            try {
              transitionReviewPassed({
                projectId,
                epicId,
                scope: "epic",
                reason: `Review verdict: passed (${lbl})`,
                sessionId: sid,
                verdictSource:
                  decision.source === "structured" ? "structured" : "prose",
              });
            } catch (err) {
              console.warn(
                "[review] review passed but to_merge promotion was refused:",
                (err as Error).message
              );
            }
          }
        }
      },
    });

    sessionsCreated.push(sessionId);
    resolutions.push({
      sessionId,
      reviewType,
      provider: resolvedAgent.provider,
      segregated: !!resolvedAgent.segregated,
      builderProvider: resolvedAgent.builderProvider ?? null,
    });
  }

  return NextResponse.json({
    data: {
      sessions: sessionsCreated,
      count: sessionsCreated.length,
      resolutions,
    },
  });
});
