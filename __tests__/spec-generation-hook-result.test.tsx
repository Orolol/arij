/**
 * useSpecGeneration — the chat's generate-spec flow (#108):
 *
 *   - the active conversation and the picked agent travel in the request
 *     body, so the server generates from THAT conversation, not the whole
 *     project's chat history,
 *   - a caller with nothing to scope still sends a bare POST — only for
 *     callers without a conversation; both chat surfaces (the chat page and
 *     the /projects/:id panel) now send their active conversation,
 *   - the success payload `{ spec, epicsCreated }` is exposed as `result` and
 *     returned by `generateSpec`, so a surface can say what happened rather
 *     than silently refreshing,
 *   - `result` is cleared when a new generation starts or an error lands.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));

import { useSpecGeneration } from "@/hooks/useSpecGeneration";

const fetchMock = vi.fn<typeof fetch>();

const ok = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => ({ data }) }) as Response;
const failed = (error: string, status = 409) =>
  ({ ok: false, status, json: async () => ({ error }) }) as Response;

beforeEach(() => {
  fetchMock.mockReset();
  navigation.refresh.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("useSpecGeneration request scope", () => {
  it("sends the active conversation and the picked agent in the body", async () => {
    fetchMock.mockResolvedValue(ok({ spec: "# S", epicsCreated: 2 }));
    const { result } = renderHook(() =>
      useSpecGeneration("p1", { conversationId: "conv-9", namedAgentId: "agent-3" })
    );

    await act(async () => {
      await result.current.generateSpec();
    });

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/projects/p1/generate-spec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "conv-9", namedAgentId: "agent-3" }),
    });
  });

  it("sends a bare POST when there is nothing to scope", async () => {
    fetchMock.mockResolvedValue(ok({ spec: "# S", epicsCreated: 0 }));
    const { result } = renderHook(() => useSpecGeneration("p1"));

    await act(async () => {
      await result.current.generateSpec();
    });

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/projects/p1/generate-spec", {
      method: "POST",
    });
  });
});

describe("useSpecGeneration outcome", () => {
  it("exposes and returns the success payload, then refreshes", async () => {
    fetchMock.mockResolvedValue(ok({ spec: "# S", epicsCreated: 3 }));
    const { result } = renderHook(() => useSpecGeneration("p1", { conversationId: "c" }));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.generateSpec();
    });

    expect(returned).toEqual({ spec: "# S", epicsCreated: 3 });
    expect(result.current.result).toEqual({ spec: "# S", epicsCreated: 3 });
    expect(result.current.error).toBeNull();
    expect(result.current.generating).toBe(false);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("surfaces the server's readable error (a 409 conflict) and clears any earlier result", async () => {
    fetchMock.mockResolvedValueOnce(ok({ spec: "# S", epicsCreated: 1 }));
    const { result } = renderHook(() => useSpecGeneration("p1", { conversationId: "c" }));
    await act(async () => {
      await result.current.generateSpec();
    });
    expect(result.current.result).not.toBeNull();

    fetchMock.mockResolvedValueOnce(
      failed("The specification changed while the agent was running. Your newer edits were preserved.")
    );
    let returned: unknown = "unset";
    await act(async () => {
      returned = await result.current.generateSpec();
    });

    expect(returned).toBeNull();
    expect(result.current.result).toBeNull();
    expect(result.current.error).toContain("newer edits were preserved");
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
});
