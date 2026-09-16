/**
 * The real chat turn strategies (lib/chat/turn-strategies.ts) driven through
 * the real runner. chat-turn-runner.test.ts pins the lifecycle with fake
 * strategies; this file pins what each real strategy promises the runner:
 *
 * - a provider that cannot even be looked up or spawned is a failed turn in
 *   the thread, and the per-turn tool channel is still released;
 * - an expired resume is retried as the same agent (CLI options, mode);
 * - a one-shot turn the client walked away from stores nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

const mocks = vi.hoisted(() => ({
  getProvider: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});
vi.mock("@/lib/utils/nanoid", () => ({ createId: vi.fn(() => "id-1") }));
vi.mock("@/lib/chat/title-generation", () => ({
  generateConversationTitle: vi.fn(async () => null),
}));
vi.mock("@/lib/providers", () => ({ getProvider: mocks.getProvider }));

import { runChatTurn, type ChatTurnStrategy } from "@/lib/chat/turn-runner";
import {
  providerCanStream,
  providerStrategy,
  providerStreamStrategy,
} from "@/lib/chat/turn-strategies";

const CLI_OPTIONS = { effort: "high" } as const;

function cliInput() {
  return {
    prompt: "FULL_PROMPT",
    turnPrompt: "Hello",
    cwd: "/tmp/repo",
    model: undefined,
    cliOptions: CLI_OPTIONS,
    toolChannel: { mcp: { url: "http://mcp" } as never, release: vi.fn() },
    cliSessionId: "cli-1",
    rememberCliSessionId: vi.fn(),
    mode: "chat" as const,
  };
}

function turn(strategy: ChatTurnStrategy) {
  return runChatTurn({
    projectId: "proj-1",
    conversationId: "conv-1",
    userContent: "Hello",
    activityLabel: "Chat",
    namedAgentName: null,
    strategy,
  });
}

async function readEvents(response: Response) {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

function assistantInserts() {
  return dbMockState.insertCalls.filter(
    (call) => (call as { role?: string }).role === "assistant",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMockState();
});

describe("a strategy whose provider fails before producing anything", () => {
  const boom = new Error("spawn EACCES");

  it.each([
    [
      "providerStrategy: unknown provider",
      () => {
        mocks.getProvider.mockImplementation(() => {
          throw boom;
        });
        const input = cliInput();
        return { input, strategy: providerStrategy({ ...input, provider: "codex", resumeSession: false }) };
      },
    ],
    [
      "providerStrategy: spawn throws",
      () => {
        mocks.getProvider.mockReturnValue({
          spawn: () => {
            throw boom;
          },
        });
        const input = cliInput();
        return { input, strategy: providerStrategy({ ...input, provider: "codex", resumeSession: false }) };
      },
    ],
    [
      "providerStreamStrategy: unknown provider",
      () => {
        mocks.getProvider.mockImplementation(() => {
          throw boom;
        });
        const input = cliInput();
        return { input, strategy: providerStreamStrategy({ ...input, provider: "claude-code", resumeSession: false }) };
      },
    ],
    [
      "providerStreamStrategy: spawnStream throws",
      () => {
        mocks.getProvider.mockReturnValue({
          spawn: vi.fn(),
          spawnStream: () => {
            throw boom;
          },
        });
        const input = cliInput();
        return { input, strategy: providerStreamStrategy({ ...input, provider: "claude-code", resumeSession: false }) };
      },
    ],
  ])("%s is a failed turn, not a thrown request", async (_name, build) => {
    // Building the strategy must not throw: the route has already minted the
    // MCP token by then, and only the runner releases it.
    const { input, strategy } = build();
    const events = await readEvents(turn(strategy));

    expect(events).toEqual([
      ...events.filter((event) => "status" in event),
      { delta: "Error: spawn EACCES" },
      { done: true, messageId: "id-1" },
    ]);
    expect(assistantInserts()).toEqual([
      expect.objectContaining({ content: "Error: spawn EACCES" }),
    ]);
    expect(dbMockState.updateCalls.at(-1)).toEqual({ status: "error" });
    expect(input.toolChannel.release).toHaveBeenCalledTimes(1);
  });
});

describe("providerStrategy", () => {
  it("retries an expired resume as a fresh session of the same agent", async () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce({
        promise: Promise.resolve({ success: false, error: "session not found" }),
        kill: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.resolve({ success: true, result: "Fresh answer" }),
        kill: vi.fn(),
      });
    mocks.getProvider.mockReturnValue({ spawn });
    const input = cliInput();

    await readEvents(turn(providerStrategy({ ...input, provider: "codex", resumeSession: true })));

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ prompt: "Hello", resumeSession: true, cliOptions: CLI_OPTIONS, mode: "chat" }),
    );
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ prompt: "FULL_PROMPT", resumeSession: false, cliOptions: CLI_OPTIONS, mode: "chat" }),
    );
  });

  it("stores nothing for a turn the client cancelled", async () => {
    let settle!: (value: { success: boolean; result: string }) => void;
    const kill = vi.fn();
    mocks.getProvider.mockReturnValue({
      spawn: () => ({
        promise: new Promise((resolve) => {
          settle = resolve;
        }),
        kill,
      }),
    });
    const input = cliInput();

    const response = turn(providerStrategy({ ...input, provider: "codex", resumeSession: false }));
    const reader = response.body!.getReader();
    await reader.read(); // the "processing" status: the spawn is running
    await reader.cancel();
    settle({ success: true, result: "Late answer" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(kill).toHaveBeenCalled();
    expect(assistantInserts()).toEqual([]);
    expect(input.toolChannel.release).toHaveBeenCalledTimes(1);
    expect(dbMockState.updateCalls.at(-1)).toEqual({ status: "active" });
  });

  it("keeps live-event deltas as the reply and appends a later failure once", async () => {
    // Bundled Pi reports text through onEvent while its one-shot promise runs.
    let onEvent!: (event: unknown) => void;
    mocks.getProvider.mockReturnValue({
      spawn: (options: { onEvent: (event: unknown) => void }) => {
        onEvent = options.onEvent;
        onEvent({ type: "text", text: "Partial" });
        return {
          promise: Promise.resolve({ success: false, result: "Partial", error: "model overloaded" }),
          kill: vi.fn(),
        };
      },
    });
    const input = cliInput();

    const events = await readEvents(
      turn(providerStrategy({ ...input, provider: "pi", resumeSession: false })),
    );

    expect(events.filter((event) => "delta" in event).map((event) => event.delta)).toEqual([
      "Partial",
      "\n\nError: model overloaded",
    ]);
    expect(assistantInserts()).toEqual([
      expect.objectContaining({ content: "Partial\n\nError: model overloaded" }),
    ]);
    // An event flushed after the turn settled has nowhere to go.
    expect(() => onEvent({ type: "text", text: " late" })).not.toThrow();
  });
});

describe("providerStreamStrategy", () => {
  it("relays the provider's stream and remembers the session", async () => {
    const spawnStream = vi.fn(() => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "status", status: "Thinking..." });
          controller.enqueue({ type: "text", text: "Streamed" });
          controller.close();
        },
      }),
      kill: vi.fn(),
    }));
    mocks.getProvider.mockReturnValue({ spawn: vi.fn(), spawnStream });
    const input = { ...cliInput(), mode: "plan" as const };

    const events = await readEvents(
      turn(providerStreamStrategy({ ...input, provider: "claude-code", resumeSession: false })),
    );

    expect(events).toEqual([
      { status: "Thinking..." },
      { delta: "Streamed" },
      { done: true, messageId: "id-1" },
    ]);
    expect(spawnStream).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Hello", mode: "plan", cliOptions: CLI_OPTIONS, cliSessionId: "cli-1" }),
    );
    expect(input.rememberCliSessionId).toHaveBeenCalledWith("cli-1");
  });
});

describe("providerCanStream", () => {
  it("is true only for an adapter with spawnStream, and never throws", () => {
    mocks.getProvider.mockReturnValueOnce({ spawn: vi.fn(), spawnStream: vi.fn() });
    expect(providerCanStream("claude-code")).toBe(true);
    mocks.getProvider.mockReturnValueOnce({ spawn: vi.fn() });
    expect(providerCanStream("codex")).toBe(false);
    mocks.getProvider.mockImplementationOnce(() => {
      throw new Error("unknown provider");
    });
    expect(providerCanStream("codex")).toBe(false);
  });
});
