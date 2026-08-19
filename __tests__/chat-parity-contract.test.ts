import { describe, expect, it } from "vitest";
import {
  LEGACY_CONVERSATION_STATUSES,
  isLegacyConversationGenerating,
  normalizeLegacyConversationStatus,
  resolveLegacyConversationLabel,
  sortConversationsForLegacyParity,
} from "@/lib/chat/parity-contract";

describe("chat parity contract", () => {
  it("declares legacy status contract", () => {
    expect(LEGACY_CONVERSATION_STATUSES).toEqual([
      "active",
      "generating",
      "generated",
      "error",
    ]);
  });

  it("normalizes unknown statuses to active and preserves known statuses", () => {
    expect(normalizeLegacyConversationStatus("active")).toBe("active");
    expect(normalizeLegacyConversationStatus("generating")).toBe("generating");
    expect(normalizeLegacyConversationStatus("generated")).toBe("generated");
    expect(normalizeLegacyConversationStatus("error")).toBe("error");
    expect(normalizeLegacyConversationStatus("queued")).toBe("active");
    expect(normalizeLegacyConversationStatus(null)).toBe("active");
  });

  it("marks only generating as active agent status", () => {
    expect(isLegacyConversationGenerating("generating")).toBe(true);
    expect(isLegacyConversationGenerating("active")).toBe(false);
    expect(isLegacyConversationGenerating("error")).toBe(false);
    expect(isLegacyConversationGenerating("unknown")).toBe(false);
  });

  it("resolves labels from explicit value or legacy type fallback", () => {
    expect(resolveLegacyConversationLabel("brainstorm", "  A custom title ")).toBe("A custom title");
    expect(resolveLegacyConversationLabel("brainstorm", "")).toBe("Brainstorm");
    expect(resolveLegacyConversationLabel("chat", "")).toBe("Chat");
    expect(resolveLegacyConversationLabel("chat", null)).toBe("Chat");
    expect(resolveLegacyConversationLabel("epic_creation", " ")).toBe("New Epic");
    expect(resolveLegacyConversationLabel("epic", null)).toBe("New Epic");
  });

  it("sorts conversations by createdAt ascending and id tie-breaker", () => {
    const sorted = sortConversationsForLegacyParity([
      { id: "c3", createdAt: "2026-02-13T00:00:03.000Z" },
      { id: "c2", createdAt: "2026-02-13T00:00:02.000Z" },
      { id: "c1", createdAt: "2026-02-13T00:00:02.000Z" },
      { id: "c4", createdAt: null },
    ]);

    expect(sorted.map((conversation) => conversation.id)).toEqual([
      "c4",
      "c1",
      "c2",
      "c3",
    ]);
  });
});
