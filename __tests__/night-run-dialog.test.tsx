/**
 * NightRunDialog: scope resolution + preview, option wiring into the batch
 * request body, the unattended-run warning, and the 409 guard copy.
 *
 * The shadcn Select is mocked as a native <select> (Radix's popper cannot be
 * driven from jsdom); every other piece of the dialog is the real component.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  NIGHT_CIRCUIT_BREAKER_SETTING_KEY,
  NIGHT_COST_CAP_SETTING_KEY,
} from "@/lib/night/constants";

vi.mock("@/components/shared/NamedAgentSelect", () => ({
  NamedAgentSelect: () => <div data-testid="named-agent-select" />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) => (
    <select
      data-testid="night-failure-policy"
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { NightRunDialog } from "@/components/night/NightRunDialog";

const EPICS = [
  { id: "e-todo-1", title: "Todo one", status: "todo" },
  { id: "e-todo-2", title: "Todo two", status: "todo" },
  { id: "e-backlog", title: "Backlog one", status: "backlog" },
  { id: "e-done", title: "Done one", status: "done" },
];

interface FetchOverrides {
  buildResponse?: { ok: boolean; status?: number; body: unknown };
  settings?: Record<string, unknown>;
  autoIncluded?: string[];
}

function mockFetch(overrides: FetchOverrides = {}) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/dependencies/transitive")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            all: ["e-todo-1"],
            autoIncluded: overrides.autoIncluded ?? ["e-prereq"],
          },
        }),
      };
    }
    if (url.endsWith("/epics")) {
      return { ok: true, status: 200, json: async () => ({ data: EPICS }) };
    }
    if (url === "/api/settings") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: overrides.settings ?? {
            [NIGHT_CIRCUIT_BREAKER_SETTING_KEY]: 4,
            [NIGHT_COST_CAP_SETTING_KEY]: 12,
          },
        }),
      };
    }
    if (url.includes("/build")) {
      const response = overrides.buildResponse ?? {
        ok: true,
        body: {
          data: {
            batchId: "night_abc",
            waves: 3,
            totalEpics: 5,
            orchestrationMode: "dag",
          },
        },
      };
      return {
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 409),
        json: async () => response.body,
      };
    }
    return { ok: true, status: 200, json: async () => ({ data: {} }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDialog() {
  const onOpenChange = vi.fn();
  const onStarted = vi.fn();
  const onError = vi.fn();
  render(
    <NightRunDialog
      projectId="proj-1"
      open
      onOpenChange={onOpenChange}
      onStarted={onStarted}
      onError={onError}
    />
  );
  return { onOpenChange, onStarted, onError };
}

/** Body of the POST /build call, once it happened. */
function buildBody(fetchMock: ReturnType<typeof vi.fn>) {
  const calls = fetchMock.mock.calls as unknown as unknown[][];
  const call = calls.find(
    (c) => typeof c[0] === "string" && (c[0] as string).endsWith("/build")
  )!;
  return JSON.parse((call[1] as { body: string }).body);
}

describe("NightRunDialog — scope preview", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("scopes To Do epics and shows the auto-included prerequisites", async () => {
    mockFetch();
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("night-scope-preview")).toHaveTextContent(
        "2 epics + 1 required prerequisite"
      )
    );
  });

  it("adds Backlog epics to the scope when the toggle is on", async () => {
    const fetchMock = mockFetch();
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("night-scope-preview")).toHaveTextContent(
        "2 epics"
      )
    );

    fireEvent.click(screen.getByTestId("night-include-backlog"));

    await waitFor(() =>
      expect(screen.getByTestId("night-scope-preview")).toHaveTextContent(
        "3 epics + 1 required prerequisite"
      )
    );

    // The preview re-asks the server with the widened scope.
    const previewCalls = (
      fetchMock.mock.calls as unknown as unknown[][]
    ).filter(
      (c) => typeof c[0] === "string" && (c[0] as string).includes("/transitive")
    );
    const lastPreview = JSON.parse(
      (previewCalls[previewCalls.length - 1][1] as { body: string }).body
    );
    expect(lastPreview.ticketIds).toEqual([
      "e-todo-1",
      "e-todo-2",
      "e-backlog",
    ]);
  });

  it("disables the confirm button when nothing is in scope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/epics")) {
          return {
            ok: true,
            json: async () => ({
              data: [{ id: "e-done", title: "Done", status: "done" }],
            }),
          };
        }
        return { ok: true, json: async () => ({ data: {} }) };
      })
    );
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("night-scope-preview")).toHaveTextContent(
        "No To Do epics to run"
      )
    );
    expect(screen.getByTestId("night-run-confirm")).toBeDisabled();
  });

  it("always shows the unattended-run warning", async () => {
    mockFetch();
    renderDialog();

    const warning = await screen.findByTestId("night-run-warning");
    expect(warning).toHaveTextContent(/unattended all night/i);
    expect(warning).toHaveTextContent(/worktrees and branches/i);
    expect(warning).toHaveTextContent(/API budget/i);
    expect(warning).toHaveTextContent(/Review for your sign-off/i);
  });

  it("warns that the cost cap only counts Claude-reported spend", async () => {
    mockFetch();
    renderDialog();

    await screen.findByTestId("night-cost-cap");
    expect(
      screen.getByText(/Claude-reported costs only/i)
    ).toBeInTheDocument();
  });
});

describe("NightRunDialog — request body", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs the night semantics: dag mode + pipeline, with the settings defaults", async () => {
    const fetchMock = mockFetch();
    const { onStarted, onOpenChange } = renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("night-circuit-breaker")).toHaveValue(4)
    );
    fireEvent.click(screen.getByTestId("night-run-confirm"));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c: unknown[]) =>
            typeof c[0] === "string" && (c[0] as string).endsWith("/build")
        )
      ).toBe(true)
    );

    const body = buildBody(fetchMock);
    expect(body).toMatchObject({
      mode: "dag",
      pipeline: true,
      failurePolicy: "halt",
      circuitBreaker: 4,
      costCapUsd: 12,
    });
    expect(body.epicIds).toEqual(["e-todo-1", "e-todo-2"]);

    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: "night_abc",
          waves: 3,
          totalEpics: 5,
          message: "Night run started — wave 1/3, 5 epics",
        })
      )
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("sends the overridden failure policy and breaker, and omits an empty cost cap", async () => {
    const fetchMock = mockFetch();
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("night-cost-cap")).toHaveValue(12)
    );

    fireEvent.change(screen.getByTestId("night-failure-policy"), {
      target: { value: "stop" },
    });
    fireEvent.change(screen.getByTestId("night-circuit-breaker"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByTestId("night-cost-cap"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByTestId("night-run-confirm"));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (c: unknown[]) =>
            typeof c[0] === "string" && (c[0] as string).endsWith("/build")
        )
      ).toBe(true)
    );

    const body = buildBody(fetchMock);
    expect(body.failurePolicy).toBe("stop");
    expect(body.circuitBreaker).toBe(0);
    expect(body).not.toHaveProperty("costCapUsd");
  });
});

describe("NightRunDialog — guard conflicts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const cases: Array<[string, RegExp]> = [
    ["NIGHT_RUN_ACTIVE", /night run is already going/i],
    ["BATCH_ACTIVE", /batch build is still running/i],
    ["PIPELINE_ACTIVE_ON_EPIC", /pipeline run is already active/i],
  ];

  for (const [code, expected] of cases) {
    it(`explains a 409 ${code}`, async () => {
      const fetchMock = mockFetch({
        buildResponse: {
          ok: false,
          status: 409,
          body: { error: "raw server message", code },
        },
      });
      const { onStarted, onError, onOpenChange } = renderDialog();

      await waitFor(() =>
        expect(screen.getByTestId("night-run-confirm")).not.toBeDisabled()
      );
      fireEvent.click(screen.getByTestId("night-run-confirm"));

      await waitFor(() =>
        expect(screen.getByTestId("night-run-error")).toHaveTextContent(expected)
      );
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(expected));
      expect(onStarted).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      expect(fetchMock).toHaveBeenCalled();
    });
  }

  it("falls back to the server message for an unknown error", async () => {
    mockFetch({
      buildResponse: {
        ok: false,
        status: 400,
        body: { error: "Pipeline batch builds run as dependency waves" },
      },
    });
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId("night-run-confirm")).not.toBeDisabled()
    );
    fireEvent.click(screen.getByTestId("night-run-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("night-run-error")).toHaveTextContent(
        "Pipeline batch builds run as dependency waves"
      )
    );
  });
});
