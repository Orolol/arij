import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { LiveSessionScreen } from "@/components/session-live/LiveSessionScreen";

const state = vi.hoisted(() => ({ projectId: "p", sessionId: "a", push: vi.fn(), actions: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: state.projectId, sessionId: state.sessionId }),
  useRouter: () => ({ push: state.push }),
}));
vi.mock("@/lib/agent-sessions/session-detail", () => ({ fetchSessionArijActions: state.actions }));
vi.mock("@/components/session-live/LiveSessionScreen", () => ({
  LiveSessionScreen: (props: ComponentProps<typeof LiveSessionScreen>) => (
    <div>
      <span data-testid="session-id">{props.session.id}</span>
      <span data-testid="actions">{JSON.stringify(props.arijActions)}</span>
      <button onClick={props.onTogglePrompt}>Prompt</button>
      <span data-testid="prompt">{props.prompt}</span>
      <button onClick={props.onDistill}>Distill</button>
    </div>
  ),
}));

import SessionDetailPage from "@/app/projects/[projectId]/sessions/[sessionId]/page";

function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
function json(data: unknown) { return new Response(JSON.stringify({ data })); }
function session(id: string) { return { id, status: "completed", agentType: "build", provider: "claude-code" }; }

beforeEach(() => {
  state.projectId = "p";
  state.sessionId = "a";
  state.push.mockReset();
  state.actions.mockReset().mockResolvedValue([]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("session detail lifecycle", () => {
  it("turns a failed initial read into a recoverable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "Session not found" }), { status: 404 })).mockResolvedValueOnce(json(session("a"))));
    render(<SessionDetailPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Session not found");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("session-id")).toHaveTextContent("a");
  });

  it("clears the prompt and ignores an old scan when moving to another session", async () => {
    const pendingPrompt = deferred();
    const pages: Array<(page: { actions: unknown[] }) => void> = [];
    state.actions.mockImplementation(async (_project: string, _session: string, options: { onPage: (page: { actions: unknown[] }) => void }) => {
      pages.push(options.onPage);
      return [];
    });
    vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("include=prompt") ? pendingPrompt.promise : Promise.resolve(json(session(url.endsWith("/a") ? "a" : "b")))));
    const view = render(<SessionDetailPage />);
    await screen.findByTestId("session-id");
    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    state.sessionId = "b";
    await act(async () => { view.rerender(<SessionDetailPage />); });
    await act(async () => {
      pendingPrompt.resolve(json({ prompt: "old private prompt" }));
      pages[0]({ actions: [{ id: "old action" }] });
    });
    expect(screen.getByTestId("session-id")).toHaveTextContent("b");
    expect(screen.getByTestId("prompt")).toBeEmptyDOMElement();
    expect(screen.getByTestId("actions")).not.toHaveTextContent("old action");
  });

  it("does not navigate after an abandoned session's distillation completes", async () => {
    const pendingDistill = deferred();
    vi.stubGlobal("fetch", vi.fn((url: string, init?: RequestInit) => init?.method === "POST" ? pendingDistill.promise : Promise.resolve(json(session(url.endsWith("/a") ? "a" : "b")))));
    const view = render(<SessionDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Distill" }));
    state.sessionId = "b";
    await act(async () => { view.rerender(<SessionDetailPage />); });
    await act(async () => { pendingDistill.resolve(json({ sessionId: "old-distillation" })); });
    expect(state.push).not.toHaveBeenCalled();
    expect(screen.getByTestId("session-id")).toHaveTextContent("b");
  });

  it("keeps polling lightweight metadata without stacking expensive action scans", async () => {
    vi.useFakeTimers();
    state.actions.mockReturnValue(new Promise(() => {}));
    const fetchMock = vi.fn().mockImplementation(async () => json(session("a")));
    vi.stubGlobal("fetch", fetchMock);
    render(<SessionDetailPage />);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(state.actions).toHaveBeenCalledTimes(1);
  });
});
