import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import { resolveCliSessionId } from "@/lib/db/resolve-cli-session-id";
import { isResumableProvider } from "./resume-capability";
import type { ProviderType } from "@/lib/providers/types";

interface ValidateResumeInput {
  resumeSessionId: string | undefined;
  epicId: string;
  userStoryId?: string;
  /**
   * The provider about to be launched. Required: a stored cliSessionId only
   * means something to the CLI that minted it, so resuming across providers
   * hands e.g. a Gemini id to `pi --session`.
   */
  expectedProvider: ProviderType | string;
}

interface ValidateResumeResult {
  cliSessionId: string;
}

// Re-exported so existing importers keep working; the list itself lives in
// resume-capability.ts, which dispatch routes and client code share.
export { isResumableProvider };

/**
 * Validates that a resume session belongs to the same scope (epic/story),
 * that its provider supports resume, and that it is the *same* provider now
 * being launched. Returns the cliSessionId if valid, null otherwise.
 */
export function validateResumeSession(
  input: ValidateResumeInput,
): ValidateResumeResult | null {
  const { resumeSessionId, epicId, userStoryId, expectedProvider } = input;

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

  // Check if the provider supports resume. Legacy rows predate the column
  // and were all Claude Code.
  const provider = prevSession.provider ?? "claude-code";
  if (!isResumableProvider(provider)) return null;

  // Cross-provider resume is never valid: the id belongs to the other CLI.
  if (provider !== expectedProvider) return null;

  // Legacy-row fallback: pre-migration rows may only have claude_session_id.
  const previousCliSessionId = resolveCliSessionId(prevSession);

  if (!previousCliSessionId) return null;

  // Epic scope must always match
  if (prevSession.epicId !== epicId) return null;

  // If story-scoped, story must match too
  if (userStoryId && prevSession.userStoryId !== userStoryId) return null;

  return { cliSessionId: previousCliSessionId };
}
