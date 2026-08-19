import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { resolveCliSessionId } from "@/lib/db/resolve-cli-session-id";
import { isResumableProvider } from "./resume-capability";

interface ValidateResumeInput {
  resumeSessionId: string | undefined;
  epicId: string;
  userStoryId?: string;
}

interface ValidateResumeResult {
  cliSessionId: string;
}

// Re-exported so existing importers keep working; the list itself lives in
// resume-capability.ts, which dispatch routes and client code share.
export { isResumableProvider };

/**
 * Validates that a resume session belongs to the same scope (epic/story)
 * and that its provider supports resume.
 * Returns the cliSessionId if valid, null otherwise.
 */
export function validateResumeSession(
  input: ValidateResumeInput,
): ValidateResumeResult | null {
  const { resumeSessionId, epicId, userStoryId } = input;

  if (!resumeSessionId) return null;

  const prevSession = db
    .select({
      cliSessionId: agentSessions.cliSessionId,
      claudeSessionId: agentSessions.claudeSessionId,
      epicId: agentSessions.epicId,
      userStoryId: agentSessions.userStoryId,
      provider: agentSessions.provider,
    })
    .from(agentSessions)
    .where(eq(agentSessions.id, resumeSessionId))
    .get();

  if (!prevSession) return null;

  // Check if the provider supports resume
  const provider = prevSession.provider ?? "claude-code";
  if (!isResumableProvider(provider)) return null;

  // Legacy-row fallback: pre-migration rows may only have claude_session_id.
  const previousCliSessionId = resolveCliSessionId(prevSession);

  if (!previousCliSessionId) return null;

  // Epic scope must always match
  if (prevSession.epicId !== epicId) return null;

  // If story-scoped, story must match too
  if (userStoryId && prevSession.userStoryId !== userStoryId) return null;

  return { cliSessionId: previousCliSessionId };
}
