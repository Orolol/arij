import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChat, type ChatSendResult } from "@/hooks/useChat";
import { useConversations, type Conversation } from "@/hooks/useConversations";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function json(data: unknown, ok = true) {
  return { ok, json: async () => ({ data }) } as Response;
}
function message(id: string) {
  return { id, projectId: "p1", role: "assistant", content: id, createdAt: "2026-09-01" };
}
function conversation(id: string, projectId = "p1"): Conversation {
  return { id, projectId, type: "brainstorm", label: id, provider: "claude-code", epicId: null, createdAt: "2026-09-01" };
}
function streaming() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  return {
    response: { ok: true, body } as Response,
    event: (event: object, terminated = true) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}${terminated ? "\n\n" : ""}`)),
    close: () => controller.close(),
    fail: () => controller.error(new Error("Connection lost")),
  };
}
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("chat history ownership", () => {
  it("ignores a slow history response after changing conversation", async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(json([message("new")]));
    const { result, rerender } = renderHook(({ id }) => useChat("p1", id), { initialProps: { id: "old" } });
    rerender({ id: "new" });
    await waitFor(() => expect(result.current.messages[0]?.id).toBe("new"));
    await act(async () => old.resolve(json([message("old")])));
    expect(result.current.messages[0]?.id).toBe("new");
    expect(result.current.loading).toBe(false);
  });

  it("clears messages immediately when no conversation is selected", async () => {
    fetchMock.mockResolvedValue(json([message("old")]));
    const { result, rerender } = renderHook(({ id }: { id: string | null }) => useChat("p1", id), { initialProps: { id: "old" as string | null } });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    rerender({ id: null });
    expect(result.current.messages).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("a history request started before sending cannot erase the optimistic turn", async () => {
    const history = deferred<Response>();
    const stream = streaming();
    fetchMock.mockReturnValueOnce(history.promise).mockResolvedValueOnce(stream.response);
    const { result } = renderHook(() => useChat("p1", "conv"));
    let sending!: Promise<ChatSendResult>;
    act(() => { sending = result.current.sendMessage("hello"); });
    await act(async () => history.resolve(json([])));
    expect(result.current.messages.map((row) => row.content)).toEqual(["hello", ""]);
    await act(async () => { stream.close(); await sending; });
  });

  it("drains background replies and does not clear another conversation's sending state", async () => {
    const first = streaming();
    const second = streaming();
    fetchMock.mockImplementation(async (url, init) => {
      if (!init?.method) return json([]);
      return JSON.parse(String(init.body)).conversationId === "one" ? first.response : second.response;
    });
    const { result, rerender } = renderHook(({ id }) => useChat("p1", id), { initialProps: { id: "one" } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    let one!: Promise<ChatSendResult>;
    let two!: Promise<ChatSendResult>;
    act(() => { one = result.current.sendMessage("first"); });
    const firstSignal = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1]!.signal;
    rerender({ id: "two" });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => { two = result.current.sendMessage("second"); });
    await act(async () => { first.event({ delta: "background" }); first.event({ done: true }); first.close(); await one; });
    expect(firstSignal?.aborted).toBe(false);
    expect(result.current.sending).toBe(true);
    expect(result.current.messages.map((row) => row.content)).toEqual(["second", ""]);
    await act(async () => { second.close(); await two; });
  });

  it("ignores duplicate sends instead of aborting the first request", async () => {
    const stream = streaming();
    fetchMock.mockResolvedValueOnce(json([])).mockResolvedValue(stream.response);
    const { result } = renderHook(() => useChat("p1", "conv"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let first!: Promise<ChatSendResult>;
    act(() => { first = result.current.sendMessage("first"); });
    await act(async () => { await result.current.sendMessage("duplicate"); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await act(async () => { stream.close(); await first; });
  });

  it("processes a final SSE event even without its trailing newline", async () => {
    const stream = streaming();
    fetchMock.mockResolvedValueOnce(json([])).mockResolvedValueOnce(stream.response).mockResolvedValueOnce(json([message("persisted")]));
    const { result } = renderHook(() => useChat("p1", "conv"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let send!: Promise<ChatSendResult>;
    act(() => { send = result.current.sendMessage("hello"); });
    await act(async () => { stream.event({ done: true }, false); stream.close(); await send; });
    expect(result.current.messages[0]?.id).toBe("persisted");
    expect(result.current.sending).toBe(false);
  });

  it("reloads persisted output when polling observes a background turn complete", async () => {
    fetchMock.mockResolvedValueOnce(json([])).mockResolvedValueOnce(json([message("persisted")]));
    const { result, rerender } = renderHook(({ status }) => useChat("p1", "conv", status), { initialProps: { status: "generating" } });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ status: "generated" });
    await waitFor(() => expect(result.current.messages[0]?.id).toBe("persisted"));
  });
});

describe("conversation list ownership", () => {
  it("a failed DELETE keeps the active conversation", async () => {
    fetchMock.mockResolvedValueOnce(json([conversation("one")])).mockResolvedValueOnce(json(null, false));
    const { result } = renderHook(() => useConversations("p1"));
    await waitFor(() => expect(result.current.activeId).toBe("one"));
    await act(async () => { expect(await result.current.deleteConversation("one")).toBe(false); });
    expect(result.current.activeId).toBe("one");
    expect(result.current.conversations).toHaveLength(1);
  });

  it("an older poll cannot resurrect a successfully deleted conversation", async () => {
    const poll = deferred<Response>();
    fetchMock.mockResolvedValueOnce(json([conversation("one"), conversation("two")])).mockReturnValueOnce(poll.promise).mockResolvedValueOnce(json(null));
    const { result } = renderHook(() => useConversations("p1"));
    await waitFor(() => expect(result.current.activeId).toBe("one"));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    await act(async () => { await result.current.deleteConversation("one"); });
    await act(async () => { poll.resolve(json([conversation("one"), conversation("two")])); await refresh; });
    expect(result.current.activeId).toBe("two");
    expect(result.current.conversations.map((row) => row.id)).toEqual(["two"]);
  });

  it("clears the active id when the server returns an empty list", async () => {
    fetchMock.mockResolvedValueOnce(json([conversation("one")])).mockResolvedValueOnce(json([]));
    const { result } = renderHook(() => useConversations("p1"));
    await waitFor(() => expect(result.current.activeId).toBe("one"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.activeId).toBeNull();
  });

  it("a creation finishing after project navigation does not enter the new project", async () => {
    const creation = deferred<Response>();
    fetchMock.mockResolvedValueOnce(json([conversation("one")])).mockReturnValueOnce(creation.promise).mockResolvedValueOnce(json([conversation("two", "p2")]));
    const { result, rerender } = renderHook(({ projectId }) => useConversations(projectId), { initialProps: { projectId: "p1" } });
    await waitFor(() => expect(result.current.activeId).toBe("one"));
    let created!: Promise<Conversation | null>;
    act(() => { created = result.current.createConversation(); });
    rerender({ projectId: "p2" });
    expect(result.current.conversations).toEqual([]);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.activeId).toBe("two"));
    await act(async () => { creation.resolve(json(conversation("late"))); await created; });
    expect(result.current.conversations.map((row) => row.id)).toEqual(["two"]);
  });
});


it("clears a history error after a successful retry", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(json([message("loaded")]));
  const { result } = renderHook(() => useChat("p1", "conv"));
  await waitFor(() => expect(result.current.error).toBeTruthy());
  await act(async () => { await result.current.refresh(); });
  expect(result.current.error).toBeNull();
  expect(result.current.messages[0]?.id).toBe("loaded");
});

it("rejects an obsolete mutation after leaving and reopening the same project", async () => {
  const creation = deferred<Response>();
  fetchMock.mockResolvedValueOnce(json([conversation("one")]))
    .mockReturnValueOnce(creation.promise)
    .mockResolvedValueOnce(json([conversation("two", "p2")]))
    .mockResolvedValueOnce(json([conversation("reopened")]));
  const { result, rerender } = renderHook(({ projectId }) => useConversations(projectId), { initialProps: { projectId: "p1" } });
  await waitFor(() => expect(result.current.activeId).toBe("one"));
  let created!: Promise<Conversation | null>;
  act(() => { created = result.current.createConversation(); });
  rerender({ projectId: "p2" });
  await waitFor(() => expect(result.current.activeId).toBe("two"));
  rerender({ projectId: "p1" });
  await waitFor(() => expect(result.current.activeId).toBe("reopened"));
  await act(async () => { creation.resolve(json(conversation("late"))); await created; });
  expect(result.current.activeId).toBe("reopened");
  expect(result.current.conversations.map((row) => row.id)).toEqual(["reopened"]);
});

it("a background stream still syncs persisted history when its conversation is reopened", async () => {
  const stream = streaming();
  let completed = false;
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
    ? stream.response : json(completed ? [message("persisted")] : []));
  const { result, rerender } = renderHook(({ id }) => useChat("p1", id), { initialProps: { id: "one" } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  let sent!: Promise<ChatSendResult>;
  act(() => { sent = result.current.sendMessage("hello"); });
  rerender({ id: "two" });
  await waitFor(() => expect(result.current.loading).toBe(false));
  rerender({ id: "one" });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => {
    completed = true;
    stream.event({ done: true });
    stream.close();
    await sent;
  });
  expect(result.current.messages[0]?.id).toBe("persisted");
});

it.each(["provider", "connection"])("keeps an accepted message after a %s stream failure", async (failure) => {
  const stream = streaming();
  const persisted = { ...message("server-user"), role: "user", content: "hello", attachments: [{ id: "image-1" }] };
  fetchMock.mockResolvedValueOnce(json([])).mockResolvedValueOnce(stream.response).mockResolvedValueOnce(json([persisted]));
  const { result } = renderHook(() => useChat("p1", "conv"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  let sent!: Promise<ChatSendResult>;
  act(() => { sent = result.current.sendMessage("hello", ["image-1"]); });
  const error = failure === "provider" ? "Provider unavailable" : "Connection lost";
  await act(async () => {
    if (failure === "provider") { stream.event({ error }); stream.close(); } else stream.fail();
    expect(await sent).toEqual({ accepted: true, error });
  });
  expect(result.current.error).toBe(error);
  expect(result.current.sending).toBe(false);
  expect(result.current.messages).toEqual([persisted]);
});

it("reports HTTP rejection without retaining an optimistic user message", async () => {
  fetchMock.mockResolvedValueOnce(json([])).mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Conversation busy" }) } as Response);
  const { result } = renderHook(() => useChat("p1", "conv"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => { expect(await result.current.sendMessage("hello")).toEqual({ accepted: false, error: "Conversation busy" }); });
  expect(result.current.messages).toEqual([]);
  expect(result.current.error).toBe("Conversation busy");
});

it.each(["before switch", "while away", "after stream closes", "before disconnection"])("restores interactive questions received %s when returning to the conversation", async (timing) => {
  const stream = streaming();
  const answer = streaming();
  let posts = 0;
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
    ? (++posts === 1 ? stream.response : answer.response) : json([]));
  const { result, rerender } = renderHook(({ id }) => useChat("p1", id, "generating"), { initialProps: { id: "one" } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  let sent!: Promise<ChatSendResult>;
  act(() => { sent = result.current.sendMessage("hello"); });
  const questions = [{ question: "Which option?", header: "Choice", options: [{ label: "A", description: "First" }], multiSelect: false }];
  if (timing !== "while away") await act(async () => { stream.event({ questions }); });
  if (timing === "after stream closes") await act(async () => { stream.close(); await sent; });
  if (timing === "before disconnection") await act(async () => { stream.fail(); await sent; });
  rerender({ id: "two" });
  await waitFor(() => expect(result.current.loading).toBe(false));
  if (timing === "while away") await act(async () => { stream.event({ questions }); });
  expect(result.current.pendingQuestions).toBeNull();
  rerender({ id: "one" });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.pendingQuestions).toEqual(questions);
  expect(result.current.sending).toBe(false);
  let answered!: Promise<ChatSendResult>;
  act(() => { answered = result.current.sendMessage("A"); });
  expect(result.current.pendingQuestions).toBeNull();
  expect(posts).toBe(2);
  await act(async () => {
    if (timing !== "after stream closes" && timing !== "before disconnection") { stream.close(); await sent; }
    answer.close();
    expect(await answered).toEqual({ accepted: true, error: null });
  });
});

it("restores sending and progress when returning during a background stream", async () => {
  const stream = streaming();
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? stream.response : json([]));
  const { result, rerender } = renderHook(({ id }) => useChat("p1", id), { initialProps: { id: "one" } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  let sent!: Promise<ChatSendResult>;
  act(() => { sent = result.current.sendMessage("hello"); });
  rerender({ id: "two" });
  await act(async () => { stream.event({ status: "Thinking" }); });
  rerender({ id: "one" });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.sending).toBe(true);
  expect(result.current.streamStatus).toBe("Thinking");
  await act(async () => { stream.close(); await sent; });
});

it("keeps the question available when the answer request is rejected", async () => {
  const stream = streaming();
  fetchMock.mockResolvedValueOnce(json([])).mockResolvedValueOnce(stream.response)
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Try again" }) } as Response);
  const { result } = renderHook(() => useChat("p1", "conv"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  let first!: Promise<ChatSendResult>;
  act(() => { first = result.current.sendMessage("hello"); });
  const questions = [{ question: "Which option?", header: "Choice", options: [], multiSelect: false }];
  await act(async () => { stream.event({ questions }); });
  await act(async () => { expect(await result.current.sendMessage("A")).toEqual({ accepted: false, error: "Try again" }); });
  expect(result.current.pendingQuestions).toEqual(questions);
  expect(result.current.sending).toBe(false);
  await act(async () => { stream.close(); await first; });
});

it("keeps partial replies when returning to a conversation whose stream is still open", async () => {
  const stream = streaming();
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? stream.response : json([]));
  const { result, rerender } = renderHook(({ id }) => useChat("p1", id), { initialProps: { id: "one" } });
  await waitFor(() => expect(result.current.loading).toBe(false));
  let sending!: Promise<ChatSendResult>;
  act(() => { sending = result.current.sendMessage("hello"); });
  await act(async () => stream.event({ delta: "First" }));
  rerender({ id: "two" });
  await waitFor(() => expect(result.current.loading).toBe(false));
  await act(async () => stream.event({ delta: " second" }));
  rerender({ id: "one" });
  expect(result.current.messages.map((message) => message.content)).toEqual(["hello", "First second"]);
  await act(async () => { stream.event({ delta: " third" }); });
  expect(result.current.messages[1]?.content).toBe("First second third");
  await act(async () => { stream.close(); await sending; });
});
