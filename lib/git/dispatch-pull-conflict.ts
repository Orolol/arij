import { dispatchBackgroundSession } from "@/lib/agent-sessions/dispatch-background-session";
import { CODE_AGENT_ALLOWED_TOOLS } from "@/lib/agent-sessions/dispatch-ticket-session";
import type { ResolvedAgent } from "@/lib/agent-config/agent-resolution";
export function dispatchPullConflictResolution(input: {
  projectId: string; sessionId: string; prompt: string; resolvedAgent: ResolvedAgent;
  cwd: string; branchName: string; cliSessionId?: string; resumeSession: boolean;
}) {
  return dispatchBackgroundSession({ ...input, agentType: "merge", mode: "code",
    session: { branchName: input.branchName, worktreePath: input.cwd },
    spawn: { resumeSession: input.resumeSession, allowedTools: CODE_AGENT_ALLOWED_TOOLS }, logPrefix: "[git/pull]" });
}
