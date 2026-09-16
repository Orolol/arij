/**
 * `useEpicCreate` — the finalisation half of epic creation, and nothing else.
 *
 * Lot 10 #52: two paths used to create an epic from one conversation with
 * different payloads — this hook (`status: "backlog"`, no `type`, parsed from
 * the whole history) and the in-thread `DraftedEpicCard` (`todo|backlog`,
 * `type: "feature"`, parsed from one message). The card is now the ONLY
 * creator. This hook asks the agent to draft the epic until one assistant
 * message parses on its own — which is exactly the condition under which the
 * thread renders that card — and never posts to `/epics` itself.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEpicCreate } from "@/hooks/useEpicCreate";

const EPIC_JSON =
  '```json\n{"title":"Auth","description":"Auth system","userStories":[{"title":"As a user, I want login so that I can access the app"}]}\n```';

const messagesResponse = (data: unknown) =>
  ({ ok: true, json: () => Promise.resolve({ data }) }) as Response;

function posts(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}

describe("useEpicCreate (finalisation only)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("never creates the epic itself: an epic already drafted in a message is enough", async () => {
    const sendMessage = vi.fn();
    fetchMock.mockResolvedValueOnce(
      messagesResponse([
        { role: "user", content: "Create an auth epic" },
        { role: "assistant", content: EPIC_JSON },
      ]),
    );

    const { result } = renderHook(() =>
      useEpicCreate({ projectId: "proj1", conversationId: "conv1", sendMessage }),
    );

    let drafted = false;
    await act(async () => {
      drafted = await result.current.draftEpic();
    });

    expect(drafted).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/proj1/chat?conversationId=conv1");
    expect(posts(fetchMock)).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it("asks for the draft when the epic only exists across several messages", async () => {
    // The conversation-level parser can stitch an epic from prose spread over
    // two replies, but no single message holds it — so no card would render.
    const sendMessage = vi.fn().mockResolvedValue({ accepted: true, error: null });
    const prose = [
      { role: "user", content: "I want to improve account security." },
      { role: "assistant", content: "Epic Title: Account Security\nDescription: Improve authentication." },
      {
        role: "assistant",
        content: "User Stories:\n- As a user, I want two-factor authentication so that my account stays secure.",
      },
    ];
    fetchMock
      .mockResolvedValueOnce(messagesResponse(prose))
      .mockResolvedValueOnce(
        messagesResponse([...prose, { role: "user", content: "…" }, { role: "assistant", content: EPIC_JSON }]),
      );

    const { result } = renderHook(() =>
      useEpicCreate({ projectId: "proj1", conversationId: "conv1", sendMessage }),
    );

    let drafted = false;
    await act(async () => {
      drafted = await result.current.draftEpic();
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      "Generate the final epic with user stories based on our discussion.",
      [],
      { finalize: true },
    );
    expect(drafted).toBe(true);
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("returns a user-friendly error when no conversation is selected", async () => {
    const { result } = renderHook(() =>
      useEpicCreate({ projectId: "proj1", conversationId: null }),
    );

    let drafted = true;
    await act(async () => {
      drafted = await result.current.draftEpic();
    });

    expect(drafted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Select an epic creation conversation first.");
  });

  it("waits for the finalisation reply instead of failing on stale messages", async () => {
    vi.useFakeTimers();
    try {
      const sendMessage = vi.fn().mockResolvedValue(undefined);
      const stale = [
        { role: "user", content: "I want auth" },
        { role: "assistant", content: "Let me help you plan an authentication system." },
      ];
      const withEpic = [
        ...stale,
        { role: "user", content: "Generate the final epic with user stories based on our discussion." },
        { role: "assistant", content: EPIC_JSON },
      ];

      fetchMock
        .mockResolvedValueOnce(messagesResponse(stale)) // initial load
        .mockResolvedValueOnce(messagesResponse(stale)) // reply not persisted yet
        .mockResolvedValueOnce(messagesResponse(stale)) // still generating
        .mockResolvedValueOnce(messagesResponse(withEpic)); // reply landed

      const { result } = renderHook(() =>
        useEpicCreate({ projectId: "proj1", conversationId: "conv1", sendMessage }),
      );

      let drafted = false;
      await act(async () => {
        const pending = result.current.draftEpic().then((value) => {
          drafted = value;
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await pending;
      });

      expect(drafted).toBe(true);
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up with a readable error after two unparseable replies", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ accepted: true, error: null });
    let replies = 1;
    fetchMock.mockImplementation(async () => {
      const list = [{ role: "user", content: "Idea" }];
      for (let index = 0; index < replies; index += 1) {
        list.push({ role: "assistant", content: `Still thinking ${index}` });
      }
      replies += 1;
      return messagesResponse(list);
    });

    const { result } = renderHook(() =>
      useEpicCreate({ projectId: "p1", conversationId: "a", sendMessage }),
    );
    await act(async () => {
      expect(await result.current.draftEpic()).toBe(false);
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result.current.error).toMatch(/couldn.t extract a full epic/i);
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it("names the failure as a draft, not a creation, when the run throws without a message", async () => {
    // A non-Error rejection falls back to the hook's own wording, which must
    // match the action on screen ("Draft the epic"): nothing is created here.
    fetchMock.mockRejectedValue("offline");
    const { result } = renderHook(() =>
      useEpicCreate({ projectId: "p1", conversationId: "a", sendMessage: vi.fn() }),
    );
    await act(async () => {
      expect(await result.current.draftEpic()).toBe(false);
    });
    expect(result.current.error).toBe("Failed to draft the epic");
  });

  it("stops finalisation immediately when sending the prompt fails", async () => {
    fetchMock.mockResolvedValue(messagesResponse([{ role: "user", content: "Idea" }]));
    const sendMessage = vi.fn(async () => false);
    const { result } = renderHook(() =>
      useEpicCreate({ projectId: "p1", conversationId: "a", sendMessage }),
    );
    await act(async () => {
      expect(await result.current.draftEpic()).toBe(false);
    });
    expect(result.current.error).toBe("Failed to send message");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("stops finalisation when the accepted prompt's reply fails", async () => {
    fetchMock.mockResolvedValue(messagesResponse([{ role: "user", content: "Idea" }]));
    const sendMessage = vi.fn(async () => ({ accepted: true, error: "Connection lost" }));
    const { result } = renderHook(() =>
      useEpicCreate({ projectId: "p1", conversationId: "a", sendMessage }),
    );
    await act(async () => {
      expect(await result.current.draftEpic()).toBe(false);
    });
    expect(result.current.error).toBe("Connection lost");
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("runs one finalisation at a time per conversation", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useEpicCreate({ projectId: "p1", conversationId: "a" }));
    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.draftEpic();
      second = result.current.draftEpic();
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    await act(async () => {
      finish(messagesResponse([{ role: "assistant", content: EPIC_JSON }]));
      expect(await first).toBe(true);
      expect(await second).toBe(false);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
  });

  it("does not publish a prior conversation's error over a different conversation", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(
      ({ conversationId }) => useEpicCreate({ projectId: "p1", conversationId }),
      { initialProps: { conversationId: "a" } },
    );
    let first!: Promise<boolean>;
    act(() => { first = result.current.draftEpic(); });
    rerender({ conversationId: "b" });
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    await act(async () => { finish({ ok: false } as Response); await first; });
    expect(result.current.error).toBeNull();
  });
});
