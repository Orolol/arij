// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { BundledPiProvider } from "@/lib/providers/bundled-pi";
import { piToolPolicy } from "@/lib/providers/pi-policy";
import { extractPiUsage, piQuestions } from "@/lib/providers/pi-events";
import { extractArijToolCalls } from "@/lib/agent-sessions/arij-actions";
import { extractSessionUsage } from "@/lib/claude/resolve-session-output";
import { isPersistentChatProvider, persistentChatBaseProvider } from "@/lib/agent-config/constants";
import { supportsTeamDelegation } from "@/lib/providers/capabilities";
import type { ProviderSpawnOptions } from "@/lib/providers/types";

const options: ProviderSpawnOptions = { sessionId: "parity", cwd: "/tmp", prompt: "test", mode: "code" };
const questions = [{ question: "Which one?", header: "Choice", options: [{ label: "A", description: "First" }], multiSelect: false }];

describe("Pi parity contract", () => {
  it("counts assistant requests once, including cached input and child usage", () => {
    const message = { role: "assistant", usage: { input: 10, output: 5, cacheRead: 20, cacheWrite: 30, cost: { total: 0.04 } } };
    const child = { type: "tool_execution_end", toolName: "Task", toolCallId: "child-1", result: { details: { usage: { inputTokens: 100, outputTokens: 10, totalCostUsd: 0.02 } } } };
    const raw = [{ type: "message_start", message }, { type: "message_end", message }, { type: "agent_end", messages: [message] }, child, child].map((value) => JSON.stringify(value)).join("\n");
    const usage = extractPiUsage(raw);
    expect(usage).toEqual({ inputTokens: 160, outputTokens: 15, totalCostUsd: 0.06 });
    expect(extractSessionUsage({ success: true, duration: 1, result: "plain answer", usage })).toEqual(usage);
    expect(extractPiUsage("plain answer")).toBeUndefined();
  });

  it("recognizes Pi MCP calls and deduplicates message echoes", () => {
    const call = { type: "toolCall", id: "call-1", name: "mcp__arij__get_ticket", arguments: {} };
    const content = [call, { type: "message_end", message: { content: [call] } }].map((value) => JSON.stringify(value)).join("\n");
    expect(extractArijToolCalls([{ content, createdAt: null }])).toEqual([{ tool: "get_ticket", at: null }]);
  });

  it("streams split JSON frames before completion without duplicating final text", () => {
    const provider = new BundledPiProvider();
    const onChunk = vi.fn();
    const onEvent = vi.fn();
    const callbacks = provider.buildChunkCallbacks({ ...options, onChunk, onEvent });
    const event = JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hello" } }) + "\n";
    const raw = (text: string) => callbacks.onRawChunk?.({ source: "stdout", index: 0, text, emittedAt: "now" });
    raw(event.slice(0, 20));
    expect(onEvent).not.toHaveBeenCalled();
    raw(event.slice(20));
    expect(onEvent).toHaveBeenCalledWith({ type: "text", text: "hello" });
    callbacks.onResponseChunk?.({ text: "hello", emittedAt: "later" });
    expect(onChunk.mock.calls.filter(([chunk]) => chunk.streamType === "response")).toHaveLength(1);
    const question = { type: "tool_execution_start", toolName: "AskUserQuestion", args: { questions } };
    raw(JSON.stringify(question) + "\n");
    expect(onEvent).toHaveBeenLastCalledWith({ type: "questions", questions });
    expect(provider.detectEndedWithQuestion(JSON.stringify(question))).toBe(true);
    expect(provider.detectEndedWithQuestion(JSON.stringify({ type: "message_start", message: { role: "user", content: "Use AskUserQuestion" } }))).toBe(false);
    expect(piQuestions({ ...question, args: { questions: [{}] } })).toBeUndefined();
  });

  it.each(["plan", "chat", "analyze"] as const)("never widens %s via permission settings", (mode) => {
    const policy = piToolPolicy({ ...options, mode, allowedTools: ["Read", "Write", "Bash", "Task"], cliOptions: { permission_mode: "bypassPermissions" } });
    expect(policy.builtinTools).not.toContain("bash");
    expect(policy.delegation).toBe(false);
    expect(policy.builtinTools.includes("write")).toBe(mode === "analyze");
  });

  it("honors explicit tools and implements conservative headless permissions", () => {
    expect(piToolPolicy({ ...options, allowedTools: ["Read", "Glob"] }).builtinTools).toEqual(["read", "find", "ls"]);
    expect(piToolPolicy({ ...options, cliOptions: { permission_mode: "acceptEdits" } }).builtinTools).not.toContain("bash");
    expect(piToolPolicy({ ...options, cliOptions: { permission_mode: "manual" } }).builtinTools).toEqual(["read", "grep", "find", "ls"]);
    expect(piToolPolicy({ ...options, allowedTools: ["Bash"], cliOptions: { permission_mode: "dontAsk" } }).builtinTools).toEqual(["bash"]);
    expect(() => piToolPolicy({ ...options, allowedTools: ["Unsupported"] })).toThrow("Unsupported");
    expect(supportsTeamDelegation("pi")).toBe(true);
    expect(supportsTeamDelegation("codex")).toBe(false);
    expect(isPersistentChatProvider("pi-persistent")).toBe(true);
    expect(persistentChatBaseProvider("pi-persistent")).toBe("pi");
  });
});
