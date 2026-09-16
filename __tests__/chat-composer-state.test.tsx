import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
vi.mock("@/components/documents/MentionTextarea", () => ({ MentionTextarea: ({ projectId: _projectId, value, onValueChange, ...props }: { projectId: string; value: string; onValueChange: (value: string) => void }) => <textarea {...props} value={value} onChange={(event) => onValueChange(event.target.value)} /> }));
vi.mock("@/components/shared/AgentSelectPill", () => ({ AgentSelectPill: () => null, AGENT_PILL_IN_COMPOSER: "" }));
import { ChatComposer } from "@/components/chat-page/ChatComposer";
import { useImageAttachments } from "@/hooks/useImageAttachments";
import { MessageInput } from "@/components/chat/MessageInput";
import type { ChatSendResult } from "@/hooks/useChat";

const fetchMock = vi.fn<typeof fetch>();
const response = (data: unknown) => ({ ok: true, json: async () => ({ data }) }) as Response;
const attachment = { id: "image-1", fileName: "draft.png", mimeType: "image/png" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
const renderers = {
  panel: (props: ComponentProps<typeof MessageInput>) => <MessageInput {...props} />,
  page: (props: ComponentProps<typeof MessageInput>) => <ChatComposer {...props} projects={[]} project={null} onSelectProject={() => {}} agentSelection={{ namedAgentId: null, provider: "claude-code" }} onSelectAgent={() => {}} agentLocked={false} />,
};
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(response(attachment)); vi.stubGlobal("fetch", fetchMock); });

for (const [surface, composer] of Object.entries(renderers)) describe(`${surface} chat composer`, () => {
  it("keeps separate text and image drafts, including an upload finishing on another conversation", async () => {
    const upload = deferred<Response>();
    fetchMock.mockReturnValueOnce(upload.promise);
    const onSend = vi.fn();
    const view = render(composer({ projectId: "p1", conversationId: "a", onSend }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft A" } });
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files: [new File(["png"], "draft.png", { type: "image/png" })] } });
    view.rerender(composer({ projectId: "p1", conversationId: "b", onSend }));
    expect(screen.getByRole("textbox")).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "draft B" } });
    await act(async () => upload.resolve(response(attachment)));
    expect(screen.queryByAltText("draft.png")).toBeNull();
    view.rerender(composer({ projectId: "p1", conversationId: "a", onSend }));
    expect(screen.getByRole("textbox")).toHaveValue("draft A");
    expect(screen.getByAltText("draft.png")).toBeInTheDocument();
    view.rerender(composer({ projectId: "p1", conversationId: "b", onSend }));
    expect(screen.getByRole("textbox")).toHaveValue("draft B");
  });

  it("restores a rejected send and its images without changing the currently selected draft", async () => {
    const send = deferred<boolean>();
    const onSend = vi.fn(() => send.promise);
    const view = render(composer({ projectId: "p1", conversationId: "a", onSend }));
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files: [new File(["png"], "draft.png", { type: "image/png" })] } });
    await screen.findByAltText("draft.png");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  retry me  " } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("retry me", ["image-1"]);
    view.rerender(composer({ projectId: "p1", conversationId: "b", onSend }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "unrelated" } });
    await act(async () => send.resolve(false));
    expect(screen.getByRole("textbox")).toHaveValue("unrelated");
    view.rerender(composer({ projectId: "p1", conversationId: "a", onSend }));
    expect(screen.getByRole("textbox")).toHaveValue("  retry me  ");
    expect(screen.getByAltText("draft.png")).toBeInTheDocument();
  });

  it("does not send Enter used to finish an IME composition", async () => {
    const onSend = vi.fn();
    render(composer({ projectId: "p1", conversationId: "a", onSend }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "日本語" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledExactlyOnceWith("日本語", []));
  });

  it("does not restore an accepted message or its images after a reply stream failure", async () => {
    const send = deferred<ChatSendResult>();
    const onSend = vi.fn(() => send.promise);
    const view = render(composer({ projectId: "p1", conversationId: "a", onSend }));
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files: [new File(["png"], "draft.png", { type: "image/png" })] } });
    await screen.findByAltText("draft.png");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "accepted message" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await act(async () => send.resolve({ accepted: true, error: "Connection lost" }));
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByAltText("draft.png")).toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledExactlyOnceWith("accepted message", ["image-1"]);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
  });

  it("surfaces an upload failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const view = render(composer({ projectId: "p1", conversationId: "a", onSend: vi.fn() }));
    fireEvent.change(view.container.querySelector("input[type=file]")!, { target: { files: [new File(["png"], "draft.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("draft.png: upload failed");
  });
});

it("keeps default attachment consumers isolated by project and discards through the owning endpoint", async () => {
  const upload = deferred<Response>();
  fetchMock.mockReturnValueOnce(upload.promise);
  const { result, rerender } = renderHook(({ projectId }) => useImageAttachments({ projectId }), { initialProps: { projectId: "p1" } });
  act(() => result.current.fileInputProps.onChange({ target: { files: [new File(["png"], "draft.png", { type: "image/png" })], value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>));
  rerender({ projectId: "p2" });
  await act(async () => upload.resolve(response(attachment)));
  expect(result.current.attachments).toEqual([]);
  expect(result.current.uploading).toBe(false);
  rerender({ projectId: "p1" });
  expect(result.current.attachments[0]?.id).toBe("image-1");
  act(() => result.current.discardAll());
  expect(fetchMock).toHaveBeenLastCalledWith("/api/projects/p1/chat/uploads/image-1", { method: "DELETE" });
});
