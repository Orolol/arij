const UNSELECTED_AGENT_TYPE = "unselected";
export const BRAINSTORM_AGENT_TYPE = "brainstorm";
export const EPIC_CREATION_AGENT_TYPE = "epic_creation";
const LEGACY_EPIC_AGENT_TYPE = "epic";
export const CHAT_AGENT_TYPE = "chat";

export function normalizeConversationAgentType(type: string | null | undefined): string {
  if (!type) return UNSELECTED_AGENT_TYPE;
  if (type === LEGACY_EPIC_AGENT_TYPE) return EPIC_CREATION_AGENT_TYPE;
  return type;
}

export function isBrainstormConversationAgentType(type: string | null | undefined): boolean {
  return normalizeConversationAgentType(type) === BRAINSTORM_AGENT_TYPE;
}

export function isEpicCreationConversationAgentType(type: string | null | undefined): boolean {
  return normalizeConversationAgentType(type) === EPIC_CREATION_AGENT_TYPE;
}

/**
 * Conversation types whose turns are strict prompt contracts: epic creation
 * must answer with refinement/finalization output (finalization in strict
 * JSON), and brainstorm is the structured spec flow. They may run in the
 * OpenAI-compatible fast mode, but board tools would corrupt their output,
 * so every tool surface — fast-mode board tools and the CLI chat tool
 * channel — is gated off for them.
 */
export function isToolIneligibleConversationAgentType(
  type: string | null | undefined
): boolean {
  return (
    isEpicCreationConversationAgentType(type) ||
    isBrainstormConversationAgentType(type)
  );
}
