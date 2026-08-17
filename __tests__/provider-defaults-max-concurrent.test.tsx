/**
 * Tests for the "Max concurrent agents" input in
 * components/agent-config/ProviderDefaultsTab.tsx: scope-aware settings key
 * (agent_max_concurrent / agent_max_concurrent:<projectId>), load, save,
 * clear-to-inherit, and input validation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ProviderDefaultsTab } from "@/components/agent-config/ProviderDefaultsTab";

vi.mock("@/hooks/useAgentConfig", () => ({
  useAgentProviders: () => ({
    data: [],
    loading: false,
    updateProvider: vi.fn(),
  }),
  useNamedAgents: () => ({ data: [] }),
}));

vi.mock("@/hooks/useProvidersAvailable", () => ({
  useProvidersAvailable: () => ({ providers: {}, loading: false }),
}));

type FetchArgs = [input: string | URL | Request, init?: RequestInit];

function jsonResponse(payload: unknown) {
  return { ok: true, json: async () => payload };
}

function findPatchCall(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.find(
    (call) => (call[1] as RequestInit | undefined)?.method === "PATCH"
  );
}

describe("ProviderDefaultsTab — max concurrent agents input", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (..._args: FetchArgs) => jsonResponse({ data: {} }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders empty with the built-in default as placeholder when unset (global scope)", async () => {
    render(<ProviderDefaultsTab scope="global" />);

    const input = screen.getByLabelText("Max concurrent agents");
    await waitFor(() => expect(input).not.toBeDisabled());
    expect(input).toHaveValue(null);
    expect(input).toHaveAttribute("placeholder", "3");
  });

  it("loads the stored global value into the input", async () => {
    fetchMock.mockImplementation(async (..._args: FetchArgs) =>
      jsonResponse({ data: { agent_max_concurrent: 5 } })
    );

    render(<ProviderDefaultsTab scope="global" />);

    const input = screen.getByLabelText("Max concurrent agents");
    await waitFor(() => expect(input).toHaveValue(5));
  });

  it("saves the global key on the settings API", async () => {
    render(<ProviderDefaultsTab scope="global" />);

    const input = screen.getByLabelText("Max concurrent agents");
    await waitFor(() => expect(input).not.toBeDisabled());

    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = findPatchCall(fetchMock);
      expect(patchCall).toBeTruthy();
      expect(String(patchCall![0])).toBe("/api/settings");
      expect(patchCall![1]?.body).toBe('{"agent_max_concurrent":2}');
    });
  });

  it("uses the per-project key and shows the inherited global value in project scope", async () => {
    fetchMock.mockImplementation(async (input: FetchArgs[0], init?: RequestInit) => {
      if (init?.method === "PATCH") return jsonResponse({ data: { updated: true } });
      return jsonResponse({ data: { agent_max_concurrent: 4 } });
    });

    render(<ProviderDefaultsTab scope="project" projectId="proj-1" />);

    const input = screen.getByLabelText("Max concurrent agents");
    await waitFor(() => expect(input).not.toBeDisabled());
    // No per-project override -> empty input, global value as placeholder.
    expect(input).toHaveValue(null);
    await waitFor(() => expect(input).toHaveAttribute("placeholder", "4"));

    fireEvent.change(input, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = findPatchCall(fetchMock);
      expect(patchCall![1]?.body).toBe('{"agent_max_concurrent:proj-1":1}');
    });
  });

  it("clears the per-project override by saving null", async () => {
    fetchMock.mockImplementation(async (input: FetchArgs[0], init?: RequestInit) => {
      if (init?.method === "PATCH") return jsonResponse({ data: { updated: true } });
      return jsonResponse({
        data: { "agent_max_concurrent:proj-1": 2, agent_max_concurrent: 4 },
      });
    });

    render(<ProviderDefaultsTab scope="project" projectId="proj-1" />);

    const input = screen.getByLabelText("Max concurrent agents");
    await waitFor(() => expect(input).toHaveValue(2));

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patchCall = findPatchCall(fetchMock);
      expect(patchCall![1]?.body).toBe('{"agent_max_concurrent:proj-1":null}');
    });
  });

  it("keeps Save disabled for invalid values and when pristine", async () => {
    render(<ProviderDefaultsTab scope="global" />);

    const input = screen.getByLabelText("Max concurrent agents");
    await waitFor(() => expect(input).not.toBeDisabled());
    const saveButton = screen.getByRole("button", { name: "Save" });

    // Pristine -> disabled.
    expect(saveButton).toBeDisabled();

    // Zero would deadlock the queue -> invalid, still disabled.
    fireEvent.change(input, { target: { value: "0" } });
    expect(saveButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "2" } });
    expect(saveButton).not.toBeDisabled();
    expect(findPatchCall(fetchMock)).toBeUndefined();
  });
});
