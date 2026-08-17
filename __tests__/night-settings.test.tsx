/**
 * Settings page: the two night-run defaults (circuit breaker, cost cap)
 * round-trip through /api/settings.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SettingsPage from "@/app/settings/page";
import {
  NIGHT_CIRCUIT_BREAKER_SETTING_KEY,
  NIGHT_COST_CAP_SETTING_KEY,
} from "@/lib/night/constants";

function mockSettings(stored: Record<string, unknown>) {
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/settings/webhooks") {
        return { ok: true, json: async () => ({ data: { webhooks: [] } }) };
      }
      if (url === "/api/settings" && init?.method === "PATCH") {
        return { ok: true, json: async () => ({ data: { updated: true } }) };
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

describe("Settings — night run defaults", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("prefills both inputs from the stored settings", async () => {
    mockSettings({
      [NIGHT_CIRCUIT_BREAKER_SETTING_KEY]: 5,
      [NIGHT_COST_CAP_SETTING_KEY]: 25,
    });
    render(<SettingsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("night-circuit-breaker-setting")).toHaveValue(5)
    );
    expect(screen.getByTestId("night-cost-cap-setting")).toHaveValue(25);
  });

  it("leaves the inputs empty when nothing is stored (engine default / unlimited)", async () => {
    mockSettings({});
    render(<SettingsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("night-settings")).toBeInTheDocument()
    );
    expect(screen.getByTestId("night-circuit-breaker-setting")).toHaveValue(null);
    expect(screen.getByTestId("night-cost-cap-setting")).toHaveValue(null);
    expect(screen.getByTestId("night-cost-cap-setting")).toHaveAttribute(
      "placeholder",
      "Unlimited"
    );
  });

  it("saves edited values as numbers", async () => {
    const fetchMock = mockSettings({});
    render(<SettingsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("night-settings")).toBeInTheDocument()
    );

    fireEvent.change(screen.getByTestId("night-circuit-breaker-setting"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByTestId("night-cost-cap-setting"), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByTestId("night-settings-save"));

    await waitFor(() =>
      expect(screen.getByTestId("night-settings-message")).toHaveTextContent(
        "Night run defaults saved."
      )
    );
    expect(lastPatchBody(fetchMock)).toEqual({
      [NIGHT_CIRCUIT_BREAKER_SETTING_KEY]: 2,
      [NIGHT_COST_CAP_SETTING_KEY]: 15,
    });
  });

  it("stores an empty cost cap as null (unlimited)", async () => {
    const fetchMock = mockSettings({
      [NIGHT_CIRCUIT_BREAKER_SETTING_KEY]: 4,
      [NIGHT_COST_CAP_SETTING_KEY]: 25,
    });
    render(<SettingsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("night-cost-cap-setting")).toHaveValue(25)
    );

    fireEvent.change(screen.getByTestId("night-cost-cap-setting"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("night-settings-save"));

    await waitFor(() =>
      expect(screen.getByTestId("night-settings-message")).toBeInTheDocument()
    );
    expect(lastPatchBody(fetchMock)).toEqual({
      [NIGHT_CIRCUIT_BREAKER_SETTING_KEY]: 4,
      [NIGHT_COST_CAP_SETTING_KEY]: null,
    });
  });

  it("reports a failed save without pretending it worked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/settings/webhooks") {
          return { ok: true, json: async () => ({ data: { webhooks: [] } }) };
        }
        if (init?.method === "PATCH") {
          return { ok: false, json: async () => ({ error: "nope" }) };
        }
        return { ok: true, json: async () => ({ data: {} }) };
      })
    );
    render(<SettingsPage />);

    await waitFor(() =>
      expect(screen.getByTestId("night-settings")).toBeInTheDocument()
    );
    fireEvent.click(screen.getByTestId("night-settings-save"));

    await waitFor(() =>
      expect(screen.getByTestId("night-settings-message")).toHaveTextContent(
        "Failed to save the night run defaults."
      )
    );
  });
});
