/**
 * The labels a conversation is created with, and the one rule that reads them.
 *
 * These strings are DATA, not copy: they are written to
 * `chat_conversations.label` and read back by every surface that lists the
 * row, and the stream route uses them as the "nobody named this yet" sentinel
 * that triggers title generation after the first exchange. Before this module
 * the same literals were retyped in each creator, each route default and the
 * sentinel, so renaming one silently stopped titling those conversations.
 * Translating them would be the same bug: a French label would never match.
 * A surface that wants a localized name for a conversation kind reads a
 * catalogue key for its TYPE, never these values.
 *
 * Client-safe on purpose (no server import): the conversation creators in
 * `components/` import the same constants the routes do.
 */
import {
  BRAINSTORM_AGENT_TYPE,
  CHAT_AGENT_TYPE,
  EPIC_CREATION_AGENT_TYPE,
  isEpicCreationConversationAgentType,
} from "@/lib/chat/conversation-agent";

export const BRAINSTORM_CONVERSATION_LABEL = "Brainstorm";
export const EPIC_CREATION_CONVERSATION_LABEL = "New Epic";
export const CHAT_CONVERSATION_LABEL = "Chat";

/** Persisted default label per built-in conversation type. */
export const DEFAULT_CONVERSATION_LABELS = {
  [BRAINSTORM_AGENT_TYPE]: BRAINSTORM_CONVERSATION_LABEL,
  [EPIC_CREATION_AGENT_TYPE]: EPIC_CREATION_CONVERSATION_LABEL,
  [CHAT_AGENT_TYPE]: CHAT_CONVERSATION_LABEL,
} as const;

const DEFAULT_LABEL_SET: ReadonlySet<string> = new Set(
  Object.values(DEFAULT_CONVERSATION_LABELS),
);

/**
 * The label a conversation of `type` gets when its creator supplies none.
 * The legacy `epic` type counts as epic creation; anything unknown (or no
 * type at all) is a brainstorm, which is what the column default has always
 * written.
 */
export function defaultConversationLabel(type: string | null | undefined): string {
  if (type === CHAT_AGENT_TYPE) return CHAT_CONVERSATION_LABEL;
  if (isEpicCreationConversationAgentType(type)) return EPIC_CREATION_CONVERSATION_LABEL;
  return BRAINSTORM_CONVERSATION_LABEL;
}

/**
 * Whether `label` is still one of the creation defaults — i.e. the title
 * generator may replace it. Exact match: a label someone typed (even one that
 * differs from a default only by case or spacing) is theirs and is kept.
 */
export function isDefaultConversationLabel(label: string | null | undefined): boolean {
  return typeof label === "string" && DEFAULT_LABEL_SET.has(label);
}
