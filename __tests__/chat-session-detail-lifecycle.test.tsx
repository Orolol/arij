import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ conversationId: "a" }));
vi.mock("next/navigation", () => ({ useParams: () => ({ projectId: "p", conversationId: route.conversationId }) }));
vi.mock("@/components/chat/MessageList", () => ({ MessageList: ({ messages }: { messages: Array<{ content: string }> }) => <div>{messages.map((message) => message.content).join(" ")}</div> }));
import ChatDetailPage from "@/app/projects/[projectId]/sessions/chat/[conversationId]/page";

function json(data: unknown) { return new Response(JSON.stringify({ data })); }
function meta(id: string) { return { id, projectId: "p", type: "chat", label: `Conversation ${id}`, status: "completed", createdAt: "2026-09-01T10:00:00Z" }; }
beforeEach(() => { route.conversationId = "a"; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("chat session transcript", () => {
  it("reports an offline read and can recover with Refresh", async () => {
    let offline = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (offline) throw new Error("offline");
      return json(url.includes("/conversations/") ? meta("a") : [{ id: "msg", role: "assistant", content: "Recovered transcript", createdAt: "2026-09-01T10:00:00Z" }]);
    }));
    render(<ChatDetailPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load the conversation");
    offline = false;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Recovered transcript")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rejects a previous conversation's late transcript", async () => {
    let resolveOld!: (response: Response) => void;
    const old = new Promise<Response>((resolve) => { resolveOld = resolve; });
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/conversations/")) return Promise.resolve(json(meta(url.endsWith("/a") ? "a" : "b")));
      return url.endsWith("=a") ? old : Promise.resolve(json([{ id: "new", role: "assistant", content: "New conversation transcript", createdAt: "2026-09-01T10:00:00Z" }]));
    });
    vi.stubGlobal("fetch", fetchMock);
    const view = render(<ChatDetailPage />);
    route.conversationId = "b";
    await act(async () => { view.rerender(<ChatDetailPage />); });
    await act(async () => { resolveOld(json([{ id: "old", role: "assistant", content: "Old conversation transcript" }])); });
    expect(screen.getByText("New conversation transcript")).toBeInTheDocument();
    expect(screen.queryByText("Old conversation transcript")).not.toBeInTheDocument();
  });
});
