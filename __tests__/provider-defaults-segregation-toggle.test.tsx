/**
 * Tests for the "Reviewer must differ from builder" toggle in
 * components/agent-config/ProviderDefaultsTab.tsx.
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

describe("ProviderDefaultsTab — review provider segregation toggle", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (..._args: FetchArgs) =>
      jsonResponse({ data: {} })
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders the toggle unchecked by default (setting absent)", async () => {
    render(<ProviderDefaultsTab scope="global" />);

    expect(
      screen.getByText("Reviewer must differ from builder")
    ).toBeInTheDocument();

    const checkbox = screen.getByRole("checkbox");
    await waitFor(() => expect(checkbox).not.toBeDisabled());
    expect(checkbox).toHaveAttribute("aria-checked", "false");
  });

  it("renders checked when the setting is 'true'", async () => {
    fetchMock.mockImplementation(async (..._args: FetchArgs) =>
      jsonResponse({ data: { review_provider_segregation: "true" } })
    );

    render(<ProviderDefaultsTab scope="global" />);

    const checkbox = screen.getByRole("checkbox");
    await waitFor(() =>
      expect(checkbox).toHaveAttribute("aria-checked", "true")
    );
  });

  it("saves 'true' to the settings API when toggled on", async () => {
    render(<ProviderDefaultsTab scope="global" />);

    const checkbox = screen.getByRole("checkbox");
    await waitFor(() => expect(checkbox).not.toBeDisabled());

    fireEvent.click(checkbox);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === "PATCH"
      );
      expect(patchCall).toBeTruthy();
      expect(String(patchCall![0])).toBe("/api/settings");
      expect(patchCall![1]?.body).toContain(
        '"review_provider_segregation":"true"'
      );
    });

    // Optimistic update sticks on success.
    expect(checkbox).toHaveAttribute("aria-checked", "true");
  });

  it("saves 'false' when toggled back off", async () => {
    fetchMock.mockImplementation(async (input: FetchArgs[0], init?: RequestInit) => {
      if (init?.method === "PATCH") return jsonResponse({ data: { updated: true } });
      return jsonResponse({ data: { review_provider_segregation: "true" } });
    });

    render(<ProviderDefaultsTab scope="global" />);

    const checkbox = screen.getByRole("checkbox");
    await waitFor(() =>
      expect(checkbox).toHaveAttribute("aria-checked", "true")
    );

    fireEvent.click(checkbox);

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        (call) => (call[1] as RequestInit | undefined)?.method === "PATCH"
      );
      expect(patchCall![1]?.body).toContain(
        '"review_provider_segregation":"false"'
      );
    });
  });

  it("reverts the optimistic update when the save fails", async () => {
    fetchMock.mockImplementation(async (input: FetchArgs[0], init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return { ok: false, json: async () => ({ error: "nope" }) };
      }
      return jsonResponse({ data: {} });
    });

    render(<ProviderDefaultsTab scope="global" />);

    const checkbox = screen.getByRole("checkbox");
    await waitFor(() => expect(checkbox).not.toBeDisabled());

    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(checkbox).toHaveAttribute("aria-checked", "false")
    );
  });
});
