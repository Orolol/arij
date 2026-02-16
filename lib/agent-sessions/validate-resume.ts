import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentSessions } from "@/lib/db/schema";
import type { ProviderType } from "@/lib/providers/types";

interface ValidateResumeInput {
  resumeSessionId: string | undefined;
  epicId: string;
  userStoryId?: string;
}

interface ValidateResumeResult {
  cliSessionId: string;
}

/**
 * Providers that support session resume.
 *
 * - claude-code: --resume <ID>
 * - gemini-cli: --resume <ID>
 * - mistral-vibe: --resume <ID>
 * - opencode: --session <ID>
 * - kimi: --continue (directory-scoped)
 *
 * Non-resumable: codex, qwen-code, deepseek, zai
 */
const RESUMABLE_PROVIDERS = new Set<ProviderType>([
  "claude-code",
  "gemini-cli",
  "mistral-vibe",
  "opencode",
  "kimi",
]);

/**
 * Returns true if the given provider supports session resume.
 */
export function isResumableProvider(provider: ProviderType | string): boolean {
  return RESUMABLE_PROVIDERS.has(provider as ProviderType);
}

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

  const previousCliSessionId =
    prevSession.cliSessionId ?? prevSession.claudeSessionId ?? null;

  if (!previousCliSessionId) return null;

  // Epic scope must always match
  if (prevSession.epicId !== epicId) return null;

  // If story-scoped, story must match too
  if (userStoryId && prevSession.userStoryId !== userStoryId) return null;

  return { cliSessionId: previousCliSessionId };
}
