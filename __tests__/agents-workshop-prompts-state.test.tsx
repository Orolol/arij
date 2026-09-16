import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptsView } from "@/components/agents-workshop/PromptsView";

function json(data: unknown) { return new Response(JSON.stringify({ data })); }
afterEach(() => { vi.unstubAllGlobals(); });

describe("agent prompt edits", () => {
  it("shows the inherited prompt after an acknowledged reset", async () => {
    let prompt = { agentType: "build", systemPrompt: "project instructions", source: "project", scope: "p" };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        prompt = { ...prompt, systemPrompt: "shared instructions", source: "global", scope: "global" };
        return json({ deleted: true });
      }
      return json(url.endsWith("/prompts") ? [prompt] : []);
    }));
    render(<PromptsView projectId="p" />);
    fireEvent.click(await screen.findByText("Build"));
    fireEvent.click(screen.getByRole("button", { name: "Reset to all projects" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Build instructions" })).toHaveValue("shared instructions"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("keeps later typing when an earlier save settles", async () => {
    let resolveSave!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveSave = resolve; });
    let serverText = "initial";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        serverText = JSON.parse(String(init.body)).systemPrompt;
        return pending;
      }
      return json(url.endsWith("/prompts") ? [{ agentType: "build", systemPrompt: serverText, source: "global", scope: "global" }] : []);
    }));
    render(<PromptsView />);
    fireEvent.click(await screen.findByText("Build"));
    const input = screen.getByRole("textbox", { name: "Build instructions" });
    fireEvent.change(input, { target: { value: "first edit" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(input, { target: { value: "second edit" } });
    await act(async () => { resolveSave(json({})); });
    expect(input).toHaveValue("second edit");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("reports a rejected save and keeps the draft editable for retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") throw new Error("offline");
      return json(url.endsWith("/prompts") ? [{ agentType: "build", systemPrompt: "initial", source: "global", scope: "global" }] : []);
    }));
    render(<PromptsView />);
    fireEvent.click(await screen.findByText("Build"));
    const input = screen.getByRole("textbox", { name: "Build instructions" });
    fireEvent.change(input, { target: { value: "keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your draft has been kept");
    expect(input).toHaveValue("keep this draft");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("does not present unreadable configuration as empty editable defaults", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "offline" }), { status: 503 })));
    render(<PromptsView />);
    await screen.findAllByRole("alert");
    expect(screen.queryByText("Build")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });
});
