import { describe, expect, it } from "vitest";
import * as contract from "@/lib/chat/parity-contract";
import {
  isLegacyConversationGenerating,
  normalizeLegacyConversationStatus,
  resolveLegacyConversationLabel,
  sortConversationsForLegacyParity,
} from "@/lib/chat/parity-contract";

describe("chat parity contract", () => {
  it("normalizes unknown statuses to active and preserves the three written ones", () => {
    expect(normalizeLegacyConversationStatus("active")).toBe("active");
    expect(normalizeLegacyConversationStatus("generating")).toBe("generating");
    expect(normalizeLegacyConversationStatus("error")).toBe("error");
    // `generated` lost its only writer with the epic-create route (ca1883dd);
    // a row still carrying it reads as an idle conversation.
    expect(normalizeLegacyConversationStatus("generated")).toBe("active");
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

  it("exports only what a consumer reads (lot 10, #51)", () => {
    expect(Object.keys(contract).sort()).toEqual([
      "isLegacyConversationGenerating",
      "normalizeLegacyConversationStatus",
      "resolveLegacyConversationLabel",
      "sortConversationsForLegacyParity",
    ]);
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
