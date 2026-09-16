import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/useEpicCreate", () => ({ useEpicCreate: () => ({ draftEpic: vi.fn(), isLoading: false, error: null }) }));
vi.mock("@/hooks/useSpecGeneration", () => ({ useSpecGeneration: () => ({ generateSpec: vi.fn(), generating: false, error: null }) }));
import { useChatWorkspace } from "@/hooks/useChatWorkspace";
import { useConversations } from "@/hooks/useConversations";
const fetchMock = vi.fn<typeof fetch>();
const conversation = { id: "a", projectId: "p1", label: "Conversation", type: "brainstorm", provider: "claude-code", epicId: null, createdAt: "2026-09-10T10:00:00Z" };
const response = (data: unknown) => ({ ok: true, json: async () => ({ data }) }) as Response;
function deferred() { let resolve!: (value: Response) => void; const promise = new Promise<Response>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockImplementation(async (url) => response(String(url).endsWith("/conversations") ? [conversation] : [])); vi.stubGlobal("fetch", fetchMock); });

describe("shared chat actions", () => {
  it("locks first-message sending until an agent change is confirmed, including the same event tick", async () => {
    const { result } = renderHook(() => useChatWorkspace("p1"));
    await waitFor(() => expect(result.current.activeId).toBe("a"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const patch = deferred();
    fetchMock.mockReturnValueOnce(patch.promise);
    let changing!: Promise<void>;
    await act(async () => { changing = result.current.selectAgent({ namedAgentId: "agent-b", provider: null }); expect(await result.current.sendMessage("hello", [])).toEqual({ accepted: false, error: null }); });
    expect(result.current.busy).toBe(true);
    expect(result.current.agentLocked).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    await act(async () => { patch.resolve(response({ ...conversation, namedAgentId: "agent-b", provider: "codex" })); await changing; });
    expect(result.current.activeAgentSelection).toEqual({ namedAgentId: "agent-b", provider: "codex" });
    expect(result.current.busy).toBe(false);
  });

  it("surfaces a failed agent update and retains the confirmed provider", async () => {
    const { result } = renderHook(() => useChatWorkspace("p1"));
    await waitFor(() => expect(result.current.activeId).toBe("a"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Agent no longer exists" }) } as Response);
    await act(async () => result.current.selectAgent({ namedAgentId: "deleted", provider: null }));
    expect(result.current.error).toBe("Agent no longer exists");
    expect(result.current.activeProvider).toBe("claude-code");
    expect(result.current.busy).toBe(false);
  });

  it("reports a rename it could not send instead of dropping it silently", async () => {
    const { result } = renderHook(() => useChatWorkspace("p1"));
    await waitFor(() => expect(result.current.activeId).toBe("a"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const patch = deferred();
    fetchMock.mockReturnValueOnce(patch.promise);
    let first!: Promise<string>;
    let second!: string;
    await act(async () => {
      first = result.current.renameConversation("a", "First");
      second = await result.current.renameConversation("a", "Second");
    });
    expect(second).toBe("busy");
    expect(result.current.renameDisabled).toBe(true);
    await act(async () => { patch.resolve(response({ ...conversation, label: "First" })); expect(await first).toBe("saved"); });
    expect(result.current.renameDisabled).toBe(false);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
  });

  it("coalesces repeated permanent conversation creation clicks", async () => {
    const { result } = renderHook(() => useConversations("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const creation = deferred();
    fetchMock.mockReturnValueOnce(creation.promise);
    let first!: ReturnType<typeof result.current.createConversation>;
    act(() => { first = result.current.createConversation(); void result.current.createConversation(); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await act(async () => { creation.resolve(response({ ...conversation, id: "new" })); await first; });
    expect(result.current.conversations).toHaveLength(2);
    expect(result.current.activeId).toBe("new");
  });
});
