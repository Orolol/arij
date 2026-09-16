import { GLOBAL_PROMPT_SETTING_KEY } from "@/lib/settings/keys";
import { withAgentResolutionErrors } from "@/lib/api/agent-resolution-response";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatMessages, chatConversations, settings, epics } from "@/lib/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { claimUploadsForChatMessage } from "@/lib/uploads/attachment-ownership";
import { createId } from "@/lib/utils/nanoid";
import { resolveCliSessionId } from "@/lib/db/resolve-cli-session-id";
import { buildChatPrompt, buildEpicRefinementPrompt, buildEpicFinalizationPrompt } from "@/lib/claude/prompt-builder";
import type { ProviderType } from "@/lib/providers";
import { resolveAgentPrompt } from "@/lib/agent-config/prompts";
import { resolveAgentByNamedId } from "@/lib/agent-config/agent-resolution";
import {
  isEpicCreationConversationAgentType,
  isToolIneligibleConversationAgentType,
} from "@/lib/chat/conversation-agent";
import {
  getOpenAiConfigFromSettings,
  type OpenAiChatMessage,
} from "@/lib/openai/client";
import { buildBoardToolsSystemSection } from "@/lib/chat/board-tools";
import { createChatCliToolChannel } from "@/lib/chat/cli-tool-channel";
import { isMcpToolsEnabled } from "@/lib/claude/mcp-injection";
import {
  enrichPromptWithDocumentMentions,
  MentionResolutionError,
  validateMentionsExist,
} from "@/lib/documents/mentions";
import {
  isPersistentChatProvider,
  isChatProvider,
  OPENAI_COMPATIBLE_PROVIDER,
  persistentChatBaseProvider,
  type ChatModeProvider,
} from "@/lib/agent-config/constants";
import { isResumableProvider } from "@/lib/agent-sessions/resume-capability";
import { mintAssignedCliSessionId } from "@/lib/agent-sessions/dispatch-background-session";
import { getProjectOr404, isErrorResponse } from "@/lib/api/route-helpers";
import { validateBody, isValidationError } from "@/lib/validation/validate";
import { chatMessageSchema } from "@/lib/validation/chat-schemas";
import {
  DEFAULT_MAX_WARM_CHAT_CONVERSATIONS,
  DEFAULT_PERSISTENT_CHAT_IDLE_TIMEOUT_MS,
  DEFAULT_PERSISTENT_CHAT_TURN_STALL_MS,
} from "@/lib/chat/persistent-runner";
import {
  parsePersistentChatCapSetting,
  parsePersistentChatDurationSetting,
  PERSISTENT_CHAT_IDLE_TIMEOUT_SETTING,
  PERSISTENT_CHAT_MAX_CONVERSATIONS_SETTING,
  PERSISTENT_CHAT_TURN_STALL_SETTING,
} from "@/lib/chat/persistent-chat-constants";
import { runChatTurn, type ChatTurnStrategy } from "@/lib/chat/turn-runner";
import {
  fastModeStrategy,
  persistentStrategy,
  providerCanStream,
  providerStrategy,
  providerStreamStrategy,
} from "@/lib/chat/turn-strategies";

/**
 * The stored conversation provider, honoured for any provider the app
 * knows — including the OpenAI-compatible fast mode, which is not a CLI
 * provider (the fast-mode strategy handles it before any CLI spawn).
 * A short allowlist here silently discards the user's choice: the
 * conversation create/update routes accept every `isChatProvider()` value,
 * so a Pi conversation would normalize to null and fall back to the
 * configured chat default — running a different CLI than the one shown.
 */
function normalizeProvider(value: string | null | undefined): ChatModeProvider | null {
  return value && isChatProvider(value) ? value : null;
}

function settingValue(key: string): unknown {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
}

export const POST = withAgentResolutionErrors(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;

  const validated = await validateBody(chatMessageSchema, request);
  if (isValidationError(validated)) return validated;
  const body = validated.data;

  if (!body.content && (!body.attachmentIds || body.attachmentIds.length === 0)) {
    return NextResponse.json(
      { error: "content or attachments required" },
      { status: 400 }
    );
  }

  // Every chat message belongs to a conversation. The one-time pass that
  // adopted conversation-less messages is migration 0061; nothing replays it,
  // so a message stored without one here would stay orphaned for good.
  if (!body.conversationId) {
    return NextResponse.json({ error: "conversationId required" }, { status: 400 });
  }

  try {
    validateMentionsExist({
      projectId,
      textSources: [body.content],
    });
  } catch (error) {
    if (error instanceof MentionResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const conversationId: string = body.conversationId;
  const attachmentIds: string[] = body.attachmentIds || [];
  const finalize: boolean = body.finalize === true;

  // Load context
  const found = getProjectOr404(projectId);
  if (isErrorResponse(found)) return found;
  const { project } = found;

  // Scoped by project: another project's conversation id reads as absent.
  const conversation = db
    .select()
    .from(chatConversations)
    .where(
      and(
        eq(chatConversations.id, conversationId),
        eq(chatConversations.projectId, projectId),
      ),
    )
    .get();
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  const conversationType = conversation.type ?? null;

  const resolvedByNamedAgent = resolveAgentByNamedId(
    "chat",
    projectId,
    conversation.namedAgentId ?? null
  );
  const conversationProvider = normalizeProvider(conversation.provider);
  const overridesProvider =
    Boolean(conversationProvider) && !conversation.namedAgentId;
  // A named agent (including a composite member) owns execution and CLI
  // options. The stored provider is only its fallback if the agent is deleted;
  // it must not route that member's model into an unrelated warm process.
  const persistentProvider =
    overridesProvider && isPersistentChatProvider(conversationProvider)
      ? conversationProvider
      : null;
  const conversationExecutionProvider = persistentProvider
    ? persistentChatBaseProvider(persistentProvider)
    : conversationProvider;
  const resolvedAgent =
    overridesProvider && conversationExecutionProvider
      ? {
          ...resolvedByNamedAgent,
          provider: conversationExecutionProvider,
          // A raw provider choice carries no model. Keeping the resolved
          // agent's model would hand e.g. `claude-opus-*` to `codex -m`,
          // which rejects it — drop it and let the CLI pick its default
          // unless both sides agree on the provider.
          model:
            conversationExecutionProvider === resolvedByNamedAgent.provider
              ? resolvedByNamedAgent.model
              : undefined,
        }
      : resolvedByNamedAgent;

  let openAiConfig: ReturnType<typeof getOpenAiConfigFromSettings> | null = null;
  if (resolvedAgent.provider === OPENAI_COMPATIBLE_PROVIDER) {

    if (attachmentIds.length > 0) {
      return NextResponse.json(
        { error: "Image attachments are not supported in OpenAI-compatible mode." },
        { status: 400 }
      );
    }

    openAiConfig = getOpenAiConfigFromSettings();
    if (!openAiConfig.baseUrl || !openAiConfig.model) {
      return NextResponse.json(
        {
          error:
            "OpenAI-compatible mode is not configured. Set the Base URL and Model in Settings.",
        },
        { status: 400 }
      );
    }
  }

  const conditions = [
    eq(chatMessages.projectId, projectId),
    eq(chatMessages.conversationId, conversationId),
  ];

  const recentMessages = db
    .select()
    .from(chatMessages)
    .where(and(...conditions))
    .orderBy(desc(chatMessages.createdAt))
    .limit(20)
    .all()
    .reverse();

  const messageHistory = recentMessages.map((m) => ({
    role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
    content: m.content,
  }));

  // Save user message (after fast-mode and parameter validation checks have passed)
  const userMsgId = createId();
  const userContent = body.content || (attachmentIds.length > 0 ? "[image]" : "");
  db.insert(chatMessages)
    .values({
      id: userMsgId,
      projectId,
      conversationId,
      role: "user",
      content: userContent,
      createdAt: new Date().toISOString(),
    })
    .run();

  // Link this project's still-staged attachments to the message.
  claimUploadsForChatMessage(projectId, userMsgId, attachmentIds);

  // Full history including the user message just saved above, required by
  // prompt builders so the agent answers the current question.
  const fullHistory = [
    ...messageHistory,
    { role: "user" as const, content: userContent },
  ];

  let prompt = "";
  let chatSystemPrompt = "";
  const isEpicCreation = isEpicCreationConversationAgentType(conversationType);
  const isFastMode =
    resolvedAgent.provider === OPENAI_COMPATIBLE_PROVIDER && openAiConfig !== null;

  if (isEpicCreation) {
    const settingsRow = db.select().from(settings).where(eq(settings.key, GLOBAL_PROMPT_SETTING_KEY)).get();
    const globalPrompt = settingsRow ? JSON.parse(settingsRow.value) : "";
    const existingEpics = db
      .select({
        title: epics.title,
        description: epics.description,
      })
      .from(epics)
      .where(eq(epics.projectId, projectId))
      .orderBy(epics.position)
      .all();

    // The CLI path ships one self-contained prompt, so the transcript it
    // embeds must include the message just saved. Fast mode sends that
    // message as its own `user` turn, so its prompt stops one turn earlier
    // — otherwise the current question travels twice.
    const historyForPrompt = isFastMode ? messageHistory : fullHistory;

    prompt = finalize
      ? buildEpicFinalizationPrompt(
          project,
          [],
          historyForPrompt,
          globalPrompt,
          existingEpics,
        )
      : buildEpicRefinementPrompt(
          project,
          [],
          historyForPrompt,
          globalPrompt,
          existingEpics,
        );
  } else {
    chatSystemPrompt = await resolveAgentPrompt("chat", projectId);
  }

  const activityLabel = conversation.label ? `Chat: ${conversation.label}` : "Chat";
  const turn = (strategy: ChatTurnStrategy) =>
    runChatTurn({
      projectId,
      conversationId,
      userContent,
      activityLabel,
      namedAgentName: resolvedAgent.name ?? null,
      strategy,
    });

  // ---------------------------------------------------------------------
  // OpenAI-compatible fast mode: dedicated HTTP path ahead of the CLI
  // strategies. History travels in the messages array (no session resume).
  // ---------------------------------------------------------------------
  if (isFastMode && openAiConfig) {
    // Parity with the CLI paths: the direct API must see the project context
    // (spec, memory, documents) too, not just the configured chat system
    // prompt — which is empty by default, leaving the model with no idea
    // which project it is talking about. History is left out here; it travels
    // as real chat messages.
    let fastModeSystemPrompt = isEpicCreation
      ? prompt
      : buildChatPrompt(project, [], [], chatSystemPrompt);

    try {
      if (fastModeSystemPrompt.trim()) {
        fastModeSystemPrompt = enrichPromptWithDocumentMentions({
          projectId,
          prompt: fastModeSystemPrompt,
          textSources: [body.content, ...messageHistory.map((m) => m.content)],
        }).prompt;
      }
    } catch (error) {
      if (error instanceof MentionResolutionError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    // Same global toggle as the CLI agents' MCP injection: off means the
    // model gets neither the tools nor a system prompt promising them.
    // Prompt-contract conversations (epic creation, brainstorm) keep their
    // structured prompts pure — no board tools there (gate parity with the
    // CLI chat tool channel).
    const chatToolsEnabled =
      !isToolIneligibleConversationAgentType(conversationType) &&
      isMcpToolsEnabled();
    const systemSections = [
      fastModeSystemPrompt.trim(),
      chatToolsEnabled ? buildBoardToolsSystemSection(project) : "",
    ].filter(Boolean);
    const openAiMessages: OpenAiChatMessage[] = [];
    if (systemSections.length > 0) {
      openAiMessages.push({ role: "system", content: systemSections.join("\n\n") });
    }
    // The epic builders embed the transcript in the system prompt already;
    // only the chat prompt needs it replayed as messages.
    if (!isEpicCreation) {
      for (const message of messageHistory) {
        openAiMessages.push({ role: message.role, content: message.content });
      }
    }
    openAiMessages.push({ role: "user", content: userContent });

    return turn(
      fastModeStrategy({
        projectId,
        config: openAiConfig,
        messages: openAiMessages,
        toolsEnabled: chatToolsEnabled,
        systemPromptWithoutTools: fastModeSystemPrompt,
      }),
    );
  }

  if (!isEpicCreation) {
    prompt = buildChatPrompt(project, [], fullHistory, chatSystemPrompt);
  }

  try {
    prompt = enrichPromptWithDocumentMentions({
      projectId,
      prompt,
      textSources: [body.content, ...fullHistory.map((m) => m.content)],
    }).prompt;
  } catch (error) {
    if (error instanceof MentionResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
  const providerSupportsResume = isResumableProvider(resolvedAgent.provider);
  // Legacy-row fallback handled inside resolveCliSessionId().
  let cliSessionId = resolveCliSessionId(conversation) ?? undefined;
  const resumeSession = Boolean(cliSessionId && providerSupportsResume);
  // Only mint for providers that take a caller-chosen id — pi reports its own.
  if (!cliSessionId) {
    cliSessionId = mintAssignedCliSessionId(resolvedAgent.provider);
  }
  // A resumed session already carries the conversation, so the new user text is
  // normally enough. Finalization is the exception: the strict JSON output
  // contract lives in the built prompt, and sending only "Generate the final
  // epic…" makes the CLI answer in prose (or with an `epics` array), which the
  // client parser then rejects. Always send the full prompt for that turn.
  const isEpicFinalization =
    finalize && isEpicCreationConversationAgentType(conversationType);
  const effectivePrompt = resumeSession && !isEpicFinalization ? userContent : prompt;

  function rememberCliSessionId(nextCliSessionId?: string) {
    if (!nextCliSessionId) return;
    db.update(chatConversations)
      .set({ cliSessionId: nextCliSessionId })
      .where(eq(chatConversations.id, conversationId))
      .run();
  }

  /**
   * Forgets a CLI session the provider no longer has. Without this the next
   * turn re-reads the same dead id and resumes into the same failure.
   */
  function forgetCliSessionId() {
    db.update(chatConversations)
      .set({ cliSessionId: null })
      .where(eq(chatConversations.id, conversationId))
      .run();
  }

  // CLI chat turns run in "chat" mode (for Claude: permission mode "default"
  // with a read-only repo allowlist). Prompt-contract conversations remain in
  // plan.
  const cliChatMode = isEpicCreationConversationAgentType(conversationType)
    ? ("plan" as const)
    : ("chat" as const);

  if (persistentProvider) {
    return turn(
      persistentStrategy({
        conversationId,
        projectId,
        provider: persistentProvider,
        executionProvider: resolvedAgent.provider,
        prompt,
        turnPrompt: effectivePrompt,
        cwd: project.gitRepoPath || process.cwd(),
        mode: cliChatMode,
        model: resolvedAgent.model,
        cliSessionId,
        resumeSession,
        conversationType,
        limits: () => ({
          idleTimeoutMs: parsePersistentChatDurationSetting(
            settingValue(PERSISTENT_CHAT_IDLE_TIMEOUT_SETTING),
            DEFAULT_PERSISTENT_CHAT_IDLE_TIMEOUT_MS,
          ),
          maxWarmConversations: parsePersistentChatCapSetting(
            settingValue(PERSISTENT_CHAT_MAX_CONVERSATIONS_SETTING),
            DEFAULT_MAX_WARM_CHAT_CONVERSATIONS,
          ),
          turnStallTimeoutMs: parsePersistentChatDurationSetting(
            settingValue(PERSISTENT_CHAT_TURN_STALL_SETTING),
            DEFAULT_PERSISTENT_CHAT_TURN_STALL_MS,
          ),
        }),
        rememberCliSessionId,
        forgetCliSessionId,
      }),
    );
  }

  // Per-turn Arij MCP tool channel for CLI chat providers (claude-code,
  // codex, oh-my-pi): the spawned CLI gets the chat toolset of arij board
  // tools, spelled per provider (mcp__arij__* on claude/codex, mcp__arij_*
  // on omp) — parity with the fast-mode board tools. Null when the provider
  // has no MCP surface, the toggle is off, or the conversation is an
  // epic-creation/brainstorm prompt contract. The runner releases it on
  // every completion path (success, error, client cancel).
  const cliToolChannel = createChatCliToolChannel({
    projectId,
    provider: resolvedAgent.provider,
    conversationType,
  });
  const cliInput = {
    prompt,
    turnPrompt: effectivePrompt,
    model: resolvedAgent.model,
    cliOptions: resolvedAgent.cliOptions,
    toolChannel: cliToolChannel,
    cliSessionId,
    rememberCliSessionId,
  };

  // Every CLI provider goes through its adapter ("openai-compatible" is not a
  // CLI provider: fast mode returned above). A resume returns one document;
  // a fresh turn streams when the provider can.
  const providerInput = {
    ...cliInput,
    provider: resolvedAgent.provider as ProviderType,
    cwd: project.gitRepoPath || process.cwd(),
    mode: cliChatMode,
    resumeSession,
  };
  return turn(
    !resumeSession && providerCanStream(providerInput.provider)
      ? providerStreamStrategy(providerInput)
      : providerStrategy(providerInput),
  );
});
