export const UNSELECTED_AGENT_TYPE = "unselected";
export const BRAINSTORM_AGENT_TYPE = "brainstorm";
export const EPIC_CREATION_AGENT_TYPE = "epic_creation";
export const LEGACY_EPIC_AGENT_TYPE = "epic";
export const CUSTOM_REVIEW_AGENT_PREFIX = "custom_review:";

export interface BuiltinConversationAgentType {
  value: string;
  label: string;
  mode: "plan" | "analyze" | "code";
}

export const BUILTIN_CONVERSATION_AGENT_TYPES: BuiltinConversationAgentType[] = [
  {
    value: BRAINSTORM_AGENT_TYPE,
    label: "Brainstorm",
    mode: "plan",
  },
  {
    value: EPIC_CREATION_AGENT_TYPE,
    label: "Epic Creation",
    mode: "plan",
  },
];

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

