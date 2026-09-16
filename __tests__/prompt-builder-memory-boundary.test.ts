import { beforeEach, describe, expect, it, vi } from "vitest";

const memory = vi.hoisted(() => vi.fn<(projectId: string) => string | null>());
vi.mock("@/lib/documents/memory", () => ({ getProjectMemoryContent: memory }));

import {
  buildBuildPrompt,
  buildChatPrompt,
  buildDreamingPrompt,
  buildMemoryDistillPrompt,
  buildSpecAutoRewritePrompt,
} from "@/lib/claude/prompt-builder";
import { buildChatPrompt as composeChat } from "@/lib/claude/prompts/conversation";

beforeEach(() => memory.mockReset());

describe("prompt facade memory resolution", () => {
  it("resolves the current project's latest memory on every call without mutating its row", () => {
    const first = Object.freeze({ id: "project-a", name: "A" });
    const second = Object.freeze({ id: "project-b", name: "B" });
    memory.mockImplementation((id) => `Learned rules for ${id}`);

    expect(buildChatPrompt(first, [], [])).toBe(
      composeChat({ ...first, memory: "Learned rules for project-a" }, [], []),
    );
    expect(buildChatPrompt(second, [], [])).toContain("Learned rules for project-b");
    memory.mockReturnValue("Newly edited rules");
    expect(buildChatPrompt(first, [], [])).toContain("Newly edited rules");
    expect(memory.mock.calls).toEqual([["project-a"], ["project-b"], ["project-a"]]);
    expect(first).not.toHaveProperty("memory");
    expect(second).not.toHaveProperty("memory");
  });

  it.each([null, "", "Explicitly resolved rules"])(
    "respects explicit memory %j without a lookup",
    (resolved) => {
      const project = { id: "project-a", name: "A", memory: resolved };
      expect(buildChatPrompt(project, [], [])).toBe(composeChat(project, [], []));
      expect(memory).not.toHaveBeenCalled();
    },
  );

  it("keeps plain projections and direct composition independent of stored memory", () => {
    memory.mockReturnValue("Database-only rules");
    const plain = { name: "A" };
    const expected = composeChat(plain, [], []);
    expect(buildChatPrompt(plain, [], [])).toBe(expected);
    expect(composeChat({ ...plain, id: "project-a" }, [], [])).toBe(expected);
    expect(memory).not.toHaveBeenCalled();
  });

  it("does not resolve reference memory for document-rewrite builders", () => {
    const project = { id: "project-a", name: "A" };
    memory.mockReturnValue("Must not be injected");
    const prompts = [
      buildMemoryDistillPrompt(project, "Current memory", {}),
      buildDreamingPrompt(project, "Current memory", {
        digest: "Session evidence", sessionCount: 1, sinceIso: "2026-09-01T00:00:00Z",
      }),
      buildSpecAutoRewritePrompt(project, "Current spec", {
        epics: [], userStories: [], releases: [],
      }, { version: "1.0.0", title: null, changelog: null }),
    ];
    expect(memory).not.toHaveBeenCalled();
    for (const prompt of prompts) expect(prompt).not.toContain("Must not be injected");
  });

  it("accounts for the resolved memory in the exact emitted section fragments", () => {
    memory.mockReturnValue("Learned project rules");
    const fragments: Array<{ key: string; text: string }> = [];
    const prompt = buildBuildPrompt(
      { id: "project-a", name: "A" }, [], { title: "Epic" }, [], null, [],
      { sectionCollector: (key, text) => fragments.push({ key, text }) },
    );
    expect(fragments.filter((fragment) => fragment.key === "memory")).toEqual([
      { key: "memory", text: expect.stringContaining("Learned project rules") },
    ]);
    expect(fragments.map((fragment) => fragment.text).join("\n")).toBe(prompt);
    expect(memory).toHaveBeenCalledExactlyOnceWith("project-a");
  });
});
