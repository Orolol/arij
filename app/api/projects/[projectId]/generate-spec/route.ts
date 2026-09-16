import { withAgentResolutionErrors } from "@/lib/api/agent-resolution-response";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { chatConversations, chatMessages } from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { createId } from "@/lib/utils/nanoid";
import { buildSpecGenerationPrompt } from "@/lib/claude/prompt-builder";
import {
  extractJsonFromOutput,
  isNoTextualOutputFallback,
  parseClaudeOutput,
} from "@/lib/claude/json-parser";
import { tryExportArjiJson } from "@/lib/sync/export";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { getProvider } from "@/lib/providers";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { validateOptionalBody, isValidationError } from "@/lib/validation/validate";
import {
  commitGeneratedSpec,
  ProjectSpecChangedError,
  saveConflictingSpecProposal,
  type GeneratedSpec,
} from "@/lib/projects/spec-write";
import { specConflictMessage } from "@/lib/workflow/spec-writers";

import { activityRegistry } from "@/lib/activity-registry";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import {
  enrichPromptWithDocumentMentions,
  userAuthoredTexts,
} from "@/lib/documents/mentions";

/** How much chat history grounds the prompt. */
const CHAT_HISTORY_LIMIT = 30;

const generateSpecSchema = z.object({
  /**
   * The conversation the user clicked "Generate Spec & Plan" in. Without it
   * the prompt falls back to the project's recent chat across every
   * conversation — the legacy shape, kept for callers with nothing to scope.
   */
  conversationId: z.string().min(1).optional(),
  /** Explicit named agent, like the other dispatch routes accept. */
  namedAgentId: z.string().min(1).optional(),
});

/**
 * POST /api/projects/[projectId]/generate-spec
 *
 * Synchronous spec + plan generation from a chat. Answers
 * `{ data: { spec, epicsCreated } }` so the surface can say what happened.
 *
 * The write goes through commitGeneratedSpec, against the spec the prompt
 * was built from: a user who saved the Spec view while the agent ran keeps
 * their edit, and the agent's proposal is kept as a `spec_proposal` document
 * (reachable by @mention, never injected by default) named in the 409.
 */
export const POST = withAgentResolutionErrors(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const validated = await validateOptionalBody(generateSpecSchema, request);
  if (isValidationError(validated)) return validated;
  const { conversationId, namedAgentId } = validated.data;

  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;
  const { project } = found;

  if (conversationId) {
    const conversation = db
      .select({ id: chatConversations.id })
      .from(chatConversations)
      .where(
        and(
          eq(chatConversations.id, conversationId),
          eq(chatConversations.projectId, projectId)
        )
      )
      .get();
    // Another project's conversation is a 404, not an empty prompt: an
    // empty history would still spend a run and rewrite the spec.
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }
  }

  const chatHistory = db
    .select()
    .from(chatMessages)
    .where(
      conversationId
        ? and(
            eq(chatMessages.projectId, projectId),
            eq(chatMessages.conversationId, conversationId)
          )
        : eq(chatMessages.projectId, projectId)
    )
    // rowid breaks createdAt ties (two messages persisted in the same
    // millisecond), so the reversed window keeps insertion order.
    .orderBy(desc(chatMessages.createdAt), desc(sql`rowid`))
    .limit(CHAT_HISTORY_LIMIT)
    .all()
    .reverse();

  const specSystemPrompt = await resolveAgentPrompt(
    "spec_generation",
    projectId
  );

  const prompt = buildSpecGenerationPrompt(
    project,
    [],
    chatHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    specSystemPrompt
  );
  // User messages only: an assistant reply naming a codebase file is not a
  // reference to an Arij document, and a dangling one never blocks generation.
  const mentionEnrichment = enrichPromptWithDocumentMentions({
    projectId,
    prompt,
    textSources: userAuthoredTexts(chatHistory),
  });
  const enrichedPrompt = mentionEnrichment.prompt;
  const resolvedAgent = resolveAgentByNamedId(
    "spec_generation",
    projectId,
    namedAgentId ?? null
  );

  const specActivityId = `spec-${createId()}`;
  activityRegistry.register({
    id: specActivityId,
    projectId,
    type: "spec_generation",
    label: "Generating Spec & Plan",
    provider: resolvedAgent.provider,
    namedAgentName: resolvedAgent.name ?? null,
    startedAt: new Date().toISOString(),
  });

  // The spec the prompt reasons from — the commit refuses to land on
  // anything else.
  const specAtPrompt = project.spec;
  let rawOutput: string | null = null;
  try {
    // Every provider goes through the provider abstraction, claude-code
    // included: the resolved provider is the one that runs, and the activity
    // record says which.
    const session = getProvider(resolvedAgent.provider).spawn({
      sessionId: `spec-${createId()}`,
      prompt: enrichedPrompt,
      cwd: project.gitRepoPath || process.cwd(),
      mode: "plan",
      model: resolvedAgent.model,
    });
    const result = await session.promise;

    if (!result.success) {
      return NextResponse.json({ error: result.error || "Claude Code failed" }, { status: 500 });
    }

    rawOutput = result.result || "";

    // Structured JSON (spec + epics) when the agent followed the prompt;
    // otherwise the whole answer is the spec text.
    const specData = extractJsonFromOutput<GeneratedSpec>(rawOutput);
    const parsed: GeneratedSpec =
      specData && (specData.epics || typeof specData.spec === "string")
        ? specData
        : { spec: parseClaudeOutput(rawOutput).content };
    // commitGeneratedSpec writes any spec that is not `undefined`, so an
    // empty, null or placeholder spec is dropped HERE: `{ spec: "", epics }`
    // adds the epics and leaves the stored spec (and the project status)
    // alone, instead of blanking the document the user wrote.
    const specText =
      typeof parsed.spec === "string" &&
      parsed.spec.trim() &&
      !isNoTextualOutputFallback(parsed.spec)
        ? parsed.spec
        : undefined;
    const generated: GeneratedSpec = { ...parsed, spec: specText };
    // Nothing at all to commit: answer an error rather than a no-op success.
    if (!generated.epics?.length && specText === undefined) {
      return NextResponse.json(
        { error: "The agent returned no specification — the saved spec was left unchanged." },
        { status: 500 }
      );
    }

    const epicsCreated = commitGeneratedSpec(projectId, specAtPrompt, generated, {
      status: "specifying",
    });
    tryExportArjiJson(projectId);
    return NextResponse.json({ data: { spec: generated.spec ?? null, epicsCreated } });
  } catch (e) {
    if (e instanceof ProjectSpecChangedError && rawOutput !== null) {
      // No session row to fail here: keep the proposal recoverable instead.
      const proposal = saveConflictingSpecProposal(projectId, rawOutput);
      return NextResponse.json(
        {
          error: specConflictMessage(e, proposal.filename),
          code: "SPEC_CHANGED",
          proposalDocumentId: proposal.id,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 }
    );
  } finally {
    activityRegistry.unregister(specActivityId);
  }
});
