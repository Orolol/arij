import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEpicCreate } from "@/hooks/useEpicCreate";

describe("useEpicCreate", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("extracts epic data from conversation and posts to /epics", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { role: "user", content: "I want to improve account security." },
              {
                role: "assistant",
                content: `
Epic Title: Account Security
Description: Improve authentication and alerts across the platform.

User Stories:
- As a user, I want two-factor authentication so that my account stays secure.
Acceptance Criteria:
- [ ] Users can enable 2FA from settings
- [ ] Recovery codes are generated
- As an admin, I want suspicious login alerts so that I can respond quickly.
Acceptance Criteria:
- [ ] Alerts are sent for unusual login locations
`,
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              id: "epic-1",
              title: "Account Security",
              userStoriesCreated: 2,
            },
          }),
      });

    const onEpicCreated = vi.fn();
    const { result } = renderHook(() =>
      useEpicCreate({
        projectId: "proj1",
        conversationId: "conv1",
        onEpicCreated,
      }),
    );

    let createdId: string | null = null;
    await act(async () => {
      createdId = await result.current.createEpic();
    });

    expect(createdId).toBe("epic-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/projects/proj1/chat?conversationId=conv1",
    );

    const createCall = fetchMock.mock.calls[1];
    expect(createCall[0]).toBe("/api/projects/proj1/epics");
    expect(createCall[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const payload = JSON.parse((createCall[1] as { body: string }).body);
    expect(payload.title).toBe("Account Security");
    expect(payload.description).toContain("Improve authentication");
    expect(payload.userStories).toHaveLength(2);
    expect(payload.userStories[0].title).toContain("As a user");

    await waitFor(() => {
      expect(result.current.createdEpic).toEqual({
        epicId: "epic-1",
        title: "Account Security",
        userStoriesCreated: 2,
      });
    });

    expect(onEpicCreated).toHaveBeenCalledWith({
      epicId: "epic-1",
      title: "Account Security",
      userStoriesCreated: 2,
    });
  });

  it("returns a user-friendly error when no conversation is selected", async () => {
    const { result } = renderHook(() =>
      useEpicCreate({
        projectId: "proj1",
        conversationId: null,
      }),
    );

    let createdId: string | null = "placeholder";
    await act(async () => {
      createdId = await result.current.createEpic();
    });

    expect(createdId).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Select an epic creation conversation first.");
  });

  it("extracts epic from existing JSON without sending finalization prompts", async () => {
    const sendMessage = vi.fn();
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { role: "user", content: "Create an auth epic" },
              {
                role: "assistant",
                content: '```json\n{"title":"Auth System","description":"Implement authentication","userStories":[{"title":"As a user, I want to log in so that I can access my account","description":"Login flow","acceptanceCriteria":"- [ ] Login form exists"}]}\n```',
              },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              id: "epic-auto",
              title: "Auth System",
              userStoriesCreated: 1,
            },
          }),
      });

    const { result } = renderHook(() =>
      useEpicCreate({
        projectId: "proj1",
        conversationId: "conv1",
        sendMessage,
      }),
    );

    let createdId: string | null = null;
    await act(async () => {
      createdId = await result.current.createEpic();
    });

    expect(createdId).toBe("epic-auto");
    // sendMessage should NOT have been called because JSON was found in existing messages
    expect(sendMessage).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to finalization prompts when existing messages lack valid JSON", async () => {
    const sendMessage = vi.fn();
    fetchMock
      // First fetch: messages without valid epic JSON
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { role: "user", content: "I want auth" },
              { role: "assistant", content: "Sure, let me help you plan an authentication system." },
            ],
          }),
      })
      // Second fetch: after finalization prompt, now has JSON
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { role: "user", content: "I want auth" },
              { role: "assistant", content: "Sure, let me help you plan an authentication system." },
              { role: "user", content: "Generate the final epic with user stories based on our discussion." },
              {
                role: "assistant",
                content: '```json\n{"title":"Auth","description":"Auth system","userStories":[{"title":"As a user, I want login so that I can access the app"}]}\n```',
              },
            ],
          }),
      })
      // Third fetch: POST to /epics
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              id: "epic-fallback",
              title: "Auth",
              userStoriesCreated: 1,
            },
          }),
      });

    const { result } = renderHook(() =>
      useEpicCreate({
        projectId: "proj1",
        conversationId: "conv1",
        sendMessage,
      }),
    );

    await act(async () => {
      await result.current.createEpic();
    });

    // sendMessage SHOULD have been called since no JSON was found in initial messages
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      "Generate the final epic with user stories based on our discussion.",
      [],
      { finalize: true },
    );
  });

  /**
   * `sendMessage` resolves as soon as the client stops reading the SSE stream —
   * which happens early when the stream is aborted or the user switches
   * conversation while the CLI is still generating. Parsing right away used to
   * report "I couldn't extract a full epic yet" seconds before the epic JSON
   * showed up in the very same conversation.
   */
  it("waits for the finalization reply instead of failing on stale messages", async () => {
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
        {
          role: "assistant",
          content:
            '```json\n{"title":"Auth","description":"Auth system","userStories":[{"title":"As a user, I want login so that I can access the app"}]}\n```',
        },
      ];
      const messagesResponse = (data: unknown) => ({
        ok: true,
        json: () => Promise.resolve({ data }),
      });

      fetchMock
        .mockResolvedValueOnce(messagesResponse(stale)) // initial load
        .mockResolvedValueOnce(messagesResponse(stale)) // reply not persisted yet
        .mockResolvedValueOnce(messagesResponse(stale)) // still generating
        .mockResolvedValueOnce(messagesResponse(withEpic)) // reply landed
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { id: "epic-late", title: "Auth", userStoriesCreated: 1 },
            }),
        });

      const { result } = renderHook(() =>
        useEpicCreate({
          projectId: "proj1",
          conversationId: "conv1",
          sendMessage,
        }),
      );

      let createdId: string | null = null;
      await act(async () => {
        const pending = result.current.createEpic().then((id) => {
          createdId = id;
        });
        await vi.advanceTimersByTimeAsync(10_000);
        await pending;
      });

      expect(createdId).toBe("epic-late");
      // A single finalization prompt was enough — the loop waited instead of
      // burning its second attempt on a reply that had not landed yet.
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(result.current.error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces API errors when epic creation fails", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { role: "assistant", content: '{"title":"Epic A","description":"Desc","user_stories":[{"title":"As a user, I want x so that y"}]}' },
            ],
          }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "Title is required" }),
      });

    const { result } = renderHook(() =>
      useEpicCreate({
        projectId: "proj1",
        conversationId: "conv1",
      }),
    );

    await act(async () => {
      await result.current.createEpic();
    });

    expect(result.current.createdEpic).toBeNull();
    expect(result.current.error).toBe("Title is required");
  });
});
