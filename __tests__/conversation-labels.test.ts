import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  BRAINSTORM_CONVERSATION_LABEL,
  CHAT_CONVERSATION_LABEL,
  DEFAULT_CONVERSATION_LABELS,
  EPIC_CREATION_CONVERSATION_LABEL,
  defaultConversationLabel,
  isDefaultConversationLabel,
} from "@/lib/chat/conversation-labels";

describe("persisted conversation labels", () => {
  it("keeps the exact strings existing rows already carry", () => {
    // Changing one of these orphans every stored row from the title sentinel.
    expect(DEFAULT_CONVERSATION_LABELS).toEqual({
      brainstorm: "Brainstorm",
      epic_creation: "New Epic",
      chat: "Chat",
    });
  });

  it.each([
    ["chat", CHAT_CONVERSATION_LABEL],
    ["epic_creation", EPIC_CREATION_CONVERSATION_LABEL],
    ["epic", EPIC_CREATION_CONVERSATION_LABEL],
    ["brainstorm", BRAINSTORM_CONVERSATION_LABEL],
    [null, BRAINSTORM_CONVERSATION_LABEL],
    ["something-else", BRAINSTORM_CONVERSATION_LABEL],
  ])("defaults type %s to %s", (type, label) => {
    expect(defaultConversationLabel(type)).toBe(label);
  });

  it("recognizes only the untouched defaults as replaceable by a generated title", () => {
    expect(isDefaultConversationLabel("Brainstorm")).toBe(true);
    expect(isDefaultConversationLabel("New Epic")).toBe(true);
    expect(isDefaultConversationLabel("Chat")).toBe(true);
    expect(isDefaultConversationLabel("brainstorm")).toBe(false);
    expect(isDefaultConversationLabel("Epic Creation")).toBe(false);
    expect(isDefaultConversationLabel("Warm chat")).toBe(false);
    expect(isDefaultConversationLabel("")).toBe(false);
    expect(isDefaultConversationLabel(null)).toBe(false);
  });

  it("stays importable from client components (no server-only import)", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "lib", "chat", "conversation-labels.ts"),
      "utf8",
    );
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(imports).toEqual(["@/lib/chat/conversation-agent"]);
    const agentSource = fs.readFileSync(
      path.join(process.cwd(), "lib", "chat", "conversation-agent.ts"),
      "utf8",
    );
    expect(agentSource).not.toMatch(/\bimport\b/);
  });

  it("is the only place the server routes spell these labels", () => {
    const serverSites = [
      "app/api/projects/[projectId]/conversations/route.ts",
      "app/api/projects/[projectId]/chat/stream/route.ts",
      "lib/chat/turn-runner.ts",
      "lib/chat/parity-contract.ts",
      "lib/chat/title-generation.ts",
    ];
    // "Chat" is also an ordinary word: the stream route names its monitor
    // activity "Chat" (not a persisted label), so that one site is held to
    // the label-shaped spellings; every other site may not spell it at all.
    const activityLabelSites = new Set(["app/api/projects/[projectId]/chat/stream/route.ts"]);
    const labelShapedChat = /(label\s*(===|!==|==|!=|:|\?\?|\|\|)\s*"Chat")|("Chat"\s*(===|!==|==|!=)\s*[\w.?]*label)/i;
    for (const site of serverSites) {
      const source = fs.readFileSync(path.join(process.cwd(), site), "utf8");
      expect(source, site).not.toMatch(/"(Brainstorm|New Epic)"/);
      expect(source, site).not.toMatch(
        activityLabelSites.has(site) ? labelShapedChat : /"Chat"/,
      );
    }
  });
});
