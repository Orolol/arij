import { defaultConversationLabel } from "@/lib/chat/conversation-labels";

/**
 * The statuses the chat stream writes to `chat_conversations.status`: idle,
 * a turn in flight, or the last turn failed (kept until the next turn).
 * `generated` used to be listed too; its only writer was the epic-create route
 * removed in ca1883dd, so a row still carrying it reads as idle.
 */
export type LegacyConversationStatus =
  | "active"
  | "generating"
  | "error";

const LEGACY_CONVERSATION_STATUSES: ReadonlyArray<LegacyConversationStatus> =
  ["active", "generating", "error"] as const;

const legacyConversationStatusSet = new Set<string>(LEGACY_CONVERSATION_STATUSES);

export function normalizeLegacyConversationStatus(
  status: string | null | undefined,
): LegacyConversationStatus {
  if (status && legacyConversationStatusSet.has(status)) {
    return status as LegacyConversationStatus;
  }
  return "active";
}

export function isLegacyConversationGenerating(
  status: string | null | undefined,
): boolean {
  return normalizeLegacyConversationStatus(status) === "generating";
}

export function resolveLegacyConversationLabel(
  type: string | null | undefined,
  label: string | null | undefined,
): string {
  if (typeof label === "string") {
    const trimmed = label.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return defaultConversationLabel(type);
}

interface SortableConversation {
  id: string;
  createdAt: string | null | undefined;
}

function parseCreatedAt(createdAt: string | null | undefined): number {
  if (!createdAt) {
    return 0;
  }
  const asMs = Date.parse(createdAt);
  return Number.isFinite(asMs) ? asMs : 0;
}

function compareConversationsByLegacyOrder(
  a: SortableConversation,
  b: SortableConversation,
): number {
  const createdAtDiff = parseCreatedAt(a.createdAt) - parseCreatedAt(b.createdAt);
  if (createdAtDiff !== 0) {
    return createdAtDiff;
  }
  return a.id.localeCompare(b.id);
}

export function sortConversationsForLegacyParity<T extends SortableConversation>(
  conversations: readonly T[],
): T[] {
  return [...conversations].sort(compareConversationsByLegacyOrder);
}
