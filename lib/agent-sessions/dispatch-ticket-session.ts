import { dispatchBackgroundSession, type BackgroundSessionTerminal } from "./dispatch-background-session";
import type { CreateQueuedSessionInput } from "./lifecycle";
import type { ResolvedAgent } from "@/lib/agent-config/agent-resolution";
import { emitSessionStarted, emitSessionCompleted, emitSessionFailed } from "@/lib/events/emit";

export const CODE_AGENT_ALLOWED_TOOLS = ["Edit", "Write", "Bash", "Read", "Glob", "Grep"];
interface TerminalResult { success: boolean; outcome: string | null; error: string | null }
interface TicketDispatch {
  row: CreateQueuedSessionInput;
  resolvedAgent: ResolvedAgent;
  resumeSession?: boolean;
  onTerminal: (run: BackgroundSessionTerminal) => TerminalResult | void | Promise<TerminalResult | void>;
}

function dispatchTicketSession(input: TicketDispatch, review: boolean) {
  const { row } = input;
  let finalResult: TerminalResult | void;
  const dispatched = dispatchBackgroundSession({
    sessionId: row.id, cliSessionId: row.cliSessionId ?? null,
    projectId: row.projectId, epicId: row.epicId, userStoryId: row.userStoryId,
    agentType: row.agentType ?? (review ? "review" : "build"), mode: "code",
    prompt: row.prompt ?? "", resolvedAgent: input.resolvedAgent,
    cwd: row.worktreePath ?? undefined,
    session: { branchName: row.branchName, worktreePath: row.worktreePath,
      estimatedPromptTokens: row.estimatedPromptTokens, estimatedPromptBreakdown: row.estimatedPromptBreakdown,
      batchRunId: row.batchRunId, orchestrationMode: row.orchestrationMode },
    spawn: { resumeSession: input.resumeSession, ...(review ? {} : { allowedTools: CODE_AGENT_ALLOWED_TOOLS }) },
    logPrefix: review ? "[ticket review]" : "[ticket build]",
    onQueued: ({ sessionId }) => emitSessionStarted(row.projectId, row.epicId!, sessionId, row.agentType ?? "build"),
    onTerminal: async (run) => {
      finalResult = await input.onTerminal(run);
      if ((finalResult ?? run).success) emitSessionCompleted(row.projectId, row.epicId!, run.sessionId);
      else emitSessionFailed(row.projectId, row.epicId!, run.sessionId, (finalResult ?? run).error ?? "Agent failed");
    },
    onLaunchFailure: (error, { sessionId }) => emitSessionFailed(row.projectId, row.epicId!, sessionId, error instanceof Error ? error.message : "Agent launch failed"),
  });
  return { ...dispatched, settled: dispatched.settled.then((run) => ({
    sessionId: run.sessionId, ...(run.launchError ? { success: false, outcome: "error", error: run.launchError instanceof Error ? run.launchError.message : String(run.launchError) } : finalResult ?? { success: run.success, outcome: run.outcome, error: run.error }),
  })) };
}
export function dispatchBuildSession(input: TicketDispatch) { return dispatchTicketSession(input, false); }
export function dispatchReviewSession(input: TicketDispatch) { return dispatchTicketSession(input, true); }

export function dispatchMergeResolution(input: TicketDispatch) { return dispatchTicketSession(input, false); }
