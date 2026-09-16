/**
 * The chat turn runner: the one owner of a chat turn's SSE stream, activity
 * registration, reply persistence, tool-channel release and cancel. Each
 * execution path of POST /chat/stream is a strategy that only produces
 * events; these tests pin the lifecycle every strategy now shares, so a new
 * path cannot quietly skip a release or a status reset again.
 *
 * The route-level SSE contract (exact frames per provider) stays pinned by
 * chat-stream-route*.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

const mockGenerateTitle = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "id-1"),
}));

vi.mock("@/lib/chat/title-generation", () => ({
  generateConversationTitle: mockGenerateTitle,
}));

import { activityRegistry } from "@/lib/activity-registry";
import {
  runChatTurn,
  type ChatTurnIO,
  type ChatTurnStrategy,
} from "@/lib/chat/turn-runner";

async function readEvents(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function strategy(overrides: Partial<ChatTurnStrategy>): ChatTurnStrategy {
  return {
    provider: "claude-code",
    onKill: "fail",
    persistAfterClientCancel: false,
    run: async () => ({ status: "active" }),
    kill: vi.fn(),
    release: vi.fn(),
    describeFailure: (error) =>
      `Error: ${error instanceof Error ? error.message : "failed"}`,
    ...overrides,
  };
}

function turn(turnStrategy: ChatTurnStrategy, conversationId: string | null = "conv-1") {
  return runChatTurn({
    projectId: "proj-1",
    conversationId,
    userContent: "Hello",
    activityLabel: "Chat: Brainstorm",
    namedAgentName: null,
    strategy: turnStrategy,
  });
}

function assistantInserts() {
  return dbMockState.insertCalls.filter(
    (call) => (call as { role?: string }).role === "assistant",
  ) as Array<{ content: string }>;
}

describe("runChatTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    mockGenerateTitle.mockResolvedValue(null);
    for (const activity of activityRegistry.listByProject("proj-1")) {
      activityRegistry.unregister(activity.id);
    }
  });

  it("streams events, persists the reply, and settles the activity and the tool channel", async () => {
    let seenActivity: unknown;
    const release = vi.fn();
    const response = turn(
      strategy({
        release,
        run: async (io: ChatTurnIO) => {
          seenActivity = activityRegistry.listByProject("proj-1")[0];
          io.emit({ type: "status", status: "Working..." });
          io.emit({ type: "text", text: "Hel" });
          io.emit({ type: "questions", questions: [] });
          io.emit({ type: "text", text: "lo" });
          return { status: "active" };
        },
      }),
    );

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(await readEvents(response)).toEqual([
      { status: "Working..." },
      { delta: "Hel" },
      { questions: [] },
      { delta: "lo" },
      { done: true, messageId: "id-1" },
    ]);
    expect(seenActivity).toMatchObject({
      id: "chat-id-1",
      type: "chat",
      provider: "claude-code",
      label: "Chat: Brainstorm",
    });
    expect(activityRegistry.listByProject("proj-1")).toEqual([]);
    expect(release).toHaveBeenCalledTimes(1);
    expect(assistantInserts()).toEqual([
      expect.objectContaining({ content: "Hello", conversationId: "conv-1" }),
    ]);
    expect(dbMockState.updateCalls).toEqual([
      { status: "generating" },
      { status: "active" },
    ]);
  });

  it("appends a thrown failure to what already streamed and marks the conversation error", async () => {
    const release = vi.fn();
    const response = turn(
      strategy({
        release,
        run: async (io) => {
          io.emit({ type: "text", text: "Partial" });
          throw new Error("boom");
        },
      }),
    );

    expect(await readEvents(response)).toEqual([
      { delta: "Partial" },
      { delta: "\n\nError: boom" },
      { done: true, messageId: "id-1" },
    ]);
    expect(assistantInserts()[0].content).toBe("Partial\n\nError: boom");
    expect(dbMockState.updateCalls.at(-1)).toEqual({ status: "error" });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("stores the empty-response placeholder rather than an empty message", async () => {
    await readEvents(turn(strategy({})));
    expect(assistantInserts()[0].content).toBe("(empty response)");
  });

  describe("a kill from the monitor", () => {
    it("ends a stop-on-kill turn quietly with nothing to persist when nothing streamed", async () => {
      const gate = deferred();
      const response = turn(
        strategy({
          onKill: "stop",
          kill: () => gate.reject(new Error("aborted")),
          run: async () => {
            await gate.promise;
            return { status: "active" };
          },
        }),
      );

      activityRegistry.cancel("chat-id-1");

      expect(await readEvents(response)).toEqual([]);
      expect(assistantInserts()).toEqual([]);
      expect(dbMockState.updateCalls.at(-1)).toEqual({ status: "active" });
    });

    it("keeps the partial reply of a stop-on-kill turn, without a failure line", async () => {
      const gate = deferred();
      const response = turn(
        strategy({
          onKill: "stop",
          kill: () => gate.reject(new Error("aborted")),
          run: async (io) => {
            io.emit({ type: "text", text: "Partial thoughts" });
            await gate.promise;
            return { status: "active" };
          },
        }),
      );

      await Promise.resolve();
      activityRegistry.cancel("chat-id-1");

      expect(await readEvents(response)).toEqual([
        { delta: "Partial thoughts" },
        { done: true, messageId: "id-1" },
      ]);
      expect(assistantInserts()[0].content).toBe("Partial thoughts");
      expect(dbMockState.updateCalls.at(-1)).toEqual({ status: "active" });
    });

    it("reports a fail-on-kill turn's failure like any other", async () => {
      const gate = deferred();
      const response = turn(
        strategy({
          onKill: "fail",
          kill: () => gate.reject(new Error("turn cancelled")),
          run: async () => {
            await gate.promise;
            return { status: "active" };
          },
        }),
      );

      activityRegistry.cancel("chat-id-1");

      expect(await readEvents(response)).toEqual([
        { delta: "Error: turn cancelled" },
        { done: true, messageId: "id-1" },
      ]);
      expect(dbMockState.updateCalls.at(-1)).toEqual({ status: "error" });
    });
  });

  describe("a client disconnect", () => {
    it("releases, unregisters, kills and resets the status at once", async () => {
      const gate = deferred();
      const kill = vi.fn(() => gate.reject(new Error("killed")));
      const release = vi.fn();
      const response = turn(
        strategy({
          kill,
          release,
          run: async () => {
            await gate.promise;
            return { status: "active" };
          },
        }),
      );

      await response.body!.cancel();

      expect(kill).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledTimes(1);
      expect(activityRegistry.listByProject("proj-1")).toEqual([]);
      expect(dbMockState.updateCalls).toContainEqual({ status: "active" });

      await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Released once even though the strategy settled after the cancel.
      expect(release).toHaveBeenCalledTimes(1);
      expect(assistantInserts()).toEqual([]);
    });

    it("still persists what streamed when the strategy keeps its reply past a disconnect", async () => {
      const gate = deferred();
      let io!: ChatTurnIO;
      const response = turn(
        strategy({
          persistAfterClientCancel: true,
          kill: () => gate.reject(new Error("turn cancelled")),
          run: async (turnIo) => {
            io = turnIo;
            io.emit({ type: "text", text: "partial answer" });
            await gate.promise;
            return { status: "active" };
          },
        }),
      );

      const reader = response.body!.getReader();
      await reader.read();
      await reader.cancel();
      // Output after the disconnect reaches neither the client nor the reply.
      io.emit({ type: "text", text: " late" });

      await vi.waitFor(() => expect(assistantInserts()).toHaveLength(1));
      expect(assistantInserts()[0].content).toBe("partial answer\n\nError: turn cancelled");
    });
  });

  describe("title generation after the first exchange", () => {
    it.each(["Brainstorm", "New Epic", "Chat"])(
      "titles a conversation still carrying the default label %s",
      async (label) => {
        mockGenerateTitle.mockResolvedValue("Importer plan");
        dbMockState.allQueue = [[{ id: "u" }, { id: "a" }]];
        dbMockState.getQueue = [{ id: "conv-1", label }];

        await readEvents(
          turn(
            strategy({
              run: async (io) => {
                io.emit({ type: "text", text: "Answer" });
                return { status: "active" };
              },
            }),
          ),
        );

        expect(mockGenerateTitle).toHaveBeenCalledWith({
          projectId: "proj-1",
          userContent: "Hello",
          assistantContent: "Answer",
        });
        await vi.waitFor(() =>
          expect(dbMockState.updateCalls).toContainEqual({ label: "Importer plan" }),
        );
      },
    );

    it("never renames a conversation someone labelled", async () => {
      dbMockState.allQueue = [[{ id: "u" }, { id: "a" }]];
      dbMockState.getQueue = [{ id: "conv-1", label: "My own name" }];

      await readEvents(
        turn(
          strategy({
            run: async (io) => {
              io.emit({ type: "text", text: "Answer" });
              return { status: "active" };
            },
          }),
        ),
      );

      expect(mockGenerateTitle).not.toHaveBeenCalled();
    });
  });
});
