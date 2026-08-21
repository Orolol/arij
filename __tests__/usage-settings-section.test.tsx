/**
 * Settings page: the optional weekly Claude budget round-trips through
 * /api/settings under the global (unsuffixed) key.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SettingsPage from "@/app/settings/page";

/** Pinned by the contract; inlined here exactly as the page inlines it. */
const BUDGET_KEY = "usage_budget_usd_7d_claude";

function mockSettings(stored: Record<string, unknown>, patchOk = true) {
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/settings/webhooks") {
        return { ok: true, json: async () => ({ data: { webhooks: [] } }) };
      }
      if (url === "/api/settings" && init?.method === "PATCH") {
        return { ok: patchOk, json: async () => ({ data: { updated: true } }) };
      }
      return { ok: true, json: async () => ({ data: stored }) };
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Body of the last PATCH /api/settings call. */
function lastPatchBody(fetchMock: ReturnType<typeof vi.fn>) {
  const calls = fetchMock.mock.calls.filter(
    (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === "PATCH"
  );
  return JSON.parse((calls[calls.length - 1][1] as { body: string }).body);
}

describe("Settings — usage budget", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("prefills the input from the stored global key", async () => {
    mockSettings({ [BUDGET_KEY]: 50 });
    render(<SettingsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("usage-budget-setting")).toHaveValue(50)
    );
  });

  it("stays empty when no budget is stored", async () => {
    mockSettings({});
    render(<SettingsPage />);

    await screen.findByTestId("usage-settings");
    expect(screen.getByTestId("usage-budget-setting")).toHaveValue(null);
  });

  it("treats a non-positive stored value as no budget", async () => {
    mockSettings({ [BUDGET_KEY]: 0 });
    render(<SettingsPage />);

    await screen.findByTestId("usage-settings");
    expect(screen.getByTestId("usage-budget-setting")).toHaveValue(null);
  });

  it("saves a positive budget under the unsuffixed key", async () => {
    const fetchMock = mockSettings({});
    render(<SettingsPage />);

    await screen.findByTestId("usage-settings");
    fireEvent.change(screen.getByTestId("usage-budget-setting"), {
      target: { value: "80" },
    });
    fireEvent.click(screen.getByTestId("usage-settings-save"));

    await waitFor(() =>
      expect(lastPatchBody(fetchMock)).toEqual({ [BUDGET_KEY]: 80 })
    );
    expect(
      await screen.findByTestId("usage-settings-message")
    ).toHaveTextContent("Saved");
  });

  it("clears the budget with null when the field is emptied", async () => {
    const fetchMock = mockSettings({ [BUDGET_KEY]: 50 });
    render(<SettingsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("usage-budget-setting")).toHaveValue(50)
    );
    fireEvent.change(screen.getByTestId("usage-budget-setting"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("usage-settings-save"));

    await waitFor(() =>
      expect(lastPatchBody(fetchMock)).toEqual({ [BUDGET_KEY]: null })
    );
  });

  it("rejects a non-positive budget without calling the API", async () => {
    const fetchMock = mockSettings({});
    render(<SettingsPage />);

    await screen.findByTestId("usage-settings");
    fireEvent.change(screen.getByTestId("usage-budget-setting"), {
      target: { value: "-5" },
    });
    fireEvent.click(screen.getByTestId("usage-settings-save"));

    expect(
      await screen.findByTestId("usage-settings-message")
    ).toHaveTextContent("Budget must be a positive dollar amount.");
    const patches = fetchMock.mock.calls.filter(
      (c: unknown[]) => (c[1] as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patches).toHaveLength(0);
  });

  it("reports a failed save", async () => {
    mockSettings({}, false);
    render(<SettingsPage />);

    await screen.findByTestId("usage-settings");
    fireEvent.change(screen.getByTestId("usage-budget-setting"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByTestId("usage-settings-save"));

    expect(
      await screen.findByTestId("usage-settings-message")
    ).toHaveTextContent("Failed to save the usage budget.");
  });

  it("explains that the budget is Arij-metered, not an account quota", async () => {
    mockSettings({});
    render(<SettingsPage />);

    const section = await screen.findByTestId("usage-settings");
    expect(section).toHaveTextContent("Claude weekly budget (USD)");
    expect(section).toHaveTextContent(
      "Arij-metered sessions only, not an account quota"
    );
  });
});
