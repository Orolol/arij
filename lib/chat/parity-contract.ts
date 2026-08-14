import { isEpicCreationConversationAgentType } from "@/lib/chat/conversation-agent";

export type LegacyConversationStatus =
  | "active"
  | "generating"
  | "generated"
  | "error";

export const LEGACY_CONVERSATION_STATUSES: ReadonlyArray<LegacyConversationStatus> =
  ["active", "generating", "generated", "error"] as const;

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
  return isEpicCreationConversationAgentType(type) ? "New Epic" : "Brainstorm";
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

export function compareConversationsByLegacyOrder(
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
