import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LimitsView } from "@/components/agents-workshop/LimitsView";
import { REVIEW_PROVIDER_SEGREGATION_SETTING_KEY } from "@/lib/agent-config/review-segregation-constants";
import { AGENT_MAX_CONCURRENT_GLOBAL_SETTING_KEY, agentMaxConcurrentSettingKey } from "@/lib/agents/scheduler-constants";

function json(data: unknown) { return new Response(JSON.stringify({ data })); }
afterEach(() => { vi.unstubAllGlobals(); });

describe("workshop runtime settings read", () => {
  it.each(["network", "http", "missing-data"])("keeps settings unresolved and blocks writes after a %s failure", async (failure) => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/projects") return json([]);
      if (url !== "/api/settings") return json({ reviewBounce: [] });
      if (failure === "network") throw new Error("offline");
      if (failure === "http") return new Response(JSON.stringify({ data: {} }), { status: 503 });
      return new Response(JSON.stringify({ error: "unreadable" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LimitsView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the agent configuration");
    const input = screen.getByRole("spinbutton", { name: "Max concurrent agents" });
    expect(input).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByTestId("agent-max-concurrent-effective")).not.toHaveTextContent("In effect:");
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.blur(input);
    expect(fetchMock.mock.calls.every((call) => call.length === 1)).toBe(true);
  });

  it("recovers on Retry and enables edits only once the stored values arrive", async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { release = resolve; });
    let settingsReads = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/projects") return Promise.resolve(json([]));
      if (url !== "/api/settings") return Promise.resolve(json({ reviewBounce: [] }));
      if (init?.method === "PATCH") return Promise.resolve(json({}));
      settingsReads += 1;
      return settingsReads === 1 ? Promise.reject(new Error("offline")) : pending;
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<LimitsView projectId="p" />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    const input = screen.getByRole("spinbutton", { name: "Max concurrent agents" });
    expect(input).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    await act(async () => {
      release(json({
        [REVIEW_PROVIDER_SEGREGATION_SETTING_KEY]: "true",
        [AGENT_MAX_CONCURRENT_GLOBAL_SETTING_KEY]: 4,
        [agentMaxConcurrentSettingKey("p")]: 2,
      }));
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeEnabled();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(input).toBeEnabled();
    expect(input).toHaveValue(2);
    expect(screen.getByTestId("agent-max-concurrent-effective")).toHaveTextContent("In effect: 2");
    fireEvent.change(input, { target: { value: "3" } });
    await act(async () => { fireEvent.blur(input); });
    const write = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(write?.[1]?.body))).toEqual({ [agentMaxConcurrentSettingKey("p")]: 3 });
  });
});
