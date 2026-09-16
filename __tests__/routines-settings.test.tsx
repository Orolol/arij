import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoutinesSettings } from "@/components/routines/RoutinesSettings";

// Radix Select uses a popper that jsdom cannot drive reliably. Keep these
// component tests focused on RoutinesSettings state and API behavior.
vi.mock("@/components/shared/NamedAgentSelect", () => ({
  NamedAgentSelect: ({
    value,
    onChange,
    disabled,
  }: {
    value: string | null;
    onChange: (v: string) => void;
    disabled?: boolean;
  }) => (
    <input
      data-testid="routine-named-agent-select"
      aria-label="Named Agent"
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
    disabled,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <select
      data-testid="routine-kind-select"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
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

const fetchMock = vi.fn();

const kinds = [
  {
    kind: "night_run",
    label: "Night run",
    description: "Starts night work.",
  },
  {
    kind: "github_issue_sync",
    label: "GitHub issue sync",
    description: "Syncs issues.",
  },
  { kind: "ci_watch", label: "CI watch", description: "Watches CI." },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

describe("RoutinesSettings", () => {
  it("keeps unsaved fields mounted through a refused refresh and its retry", async () => {
    const routine = { id: "r1", projectId: "p1", kind: "night_run", enabled: true, timeOfDay: "23:00", config: {}, lastRunAt: null, lastStatus: null };
    fetchMock.mockResolvedValue(jsonResponse({ data: [routine], meta: { availableKinds: kinds } }));
    render(<RoutinesSettings projectId="p1" />);
    const config = await screen.findByLabelText("Configuration (JSON)");
    fireEvent.change(config, { target: { value: '{"includeBacklog":true}' } });
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Refresh refused" }, 503));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Refresh refused");
    expect(config).toBeInTheDocument();
    expect(config).toHaveValue('{"includeBacklog":true}');
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.queryByText("Refresh refused")).not.toBeInTheDocument());
    expect(config).toHaveValue('{"includeBacklog":true}');
  });

  it("locks repeated saves immediately and retains a draft on a refused write", async () => {
    const routine = { id: "r1", projectId: "p1", kind: "night_run", enabled: true, timeOfDay: "23:00", config: {}, lastRunAt: null, lastStatus: null };
    let finish!: (response: Response) => void;
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [routine], meta: { availableKinds: kinds } }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    render(<RoutinesSettings projectId="p1" />);
    const config = await screen.findByLabelText("Configuration (JSON)");
    fireEvent.change(config, { target: { value: '{"includeBacklog":true}' } });
    const save = screen.getByRole("button", { name: "Save changes" });
    act(() => { fireEvent.click(save); fireEvent.click(save); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    expect(config).toBeDisabled();
    await act(async () => { finish(jsonResponse({ error: "Save refused" }, 409)); });
    expect(await screen.findByText("Save refused")).toHaveAttribute("role", "alert");
    expect(config).toHaveValue('{"includeBacklog":true}');
    expect(config).toBeEnabled();
  });

  it("treats a malformed initial list as unknown and blocks configuration changes", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: {} }));
    render(<RoutinesSettings projectId="p1" />);
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Add routine" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.queryByText("No routines configured")).not.toBeInTheDocument();
  });

  it("shows status and server-local scheduling while hiding unavailable kinds", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "r1",
            projectId: "p1",
            kind: "night_run",
            enabled: true,
            timeOfDay: "23:00",
            config: { includeBacklog: false },
            lastRunAt: "2026-08-25T19:00:00.000Z",
            lastStatus: "completed",
          },
        ],
        meta: {
          availableKinds: kinds,
          serverTimezone: "Europe/Paris",
          ciAutofixEnabled: false,
        },
      }),
    );

    render(<RoutinesSettings projectId="p1" />);

    expect(await screen.findByText("Scheduled routines")).toBeInTheDocument();
    expect(await screen.findByTestId("routine-r1")).toBeInTheDocument();
    expect(screen.getByText(/server's local timezone/)).toHaveTextContent(
      "Europe/Paris",
    );
    expect(screen.getByText(/Last run:/)).toBeInTheDocument();
    expect(screen.getAllByText("completed").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("option", { name: "Dreaming" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Enable CI autofix")).not.toBeChecked();
  });

  it("presents a seeded missed slot as scheduled rather than a completed run", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "r-seeded",
            projectId: "p1",
            kind: "night_run",
            enabled: true,
            timeOfDay: "22:00",
            config: {},
            lastRunAt: "2026-08-25T21:15:00.000Z",
            lastStatus: "scheduled",
          },
        ],
        meta: {
          availableKinds: kinds,
          serverTimezone: "Europe/Paris",
          ciAutofixEnabled: false,
        },
      }),
    );

    render(<RoutinesSettings projectId="p1" />);

    expect(await screen.findByTestId("routine-r-seeded")).toBeInTheDocument();
    expect(screen.getByText(/first run/i)).toHaveTextContent(
      /scheduled for tomorrow/,
    );
    expect(screen.queryByText(/Last run:/)).not.toBeInTheDocument();
    expect(screen.getAllByText("scheduled").length).toBeGreaterThan(0);
  });

  it("creates a routine with kind, time, enabled state and parsed config", async () => {
    fetchMock.mockImplementation(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/routines") && init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          return jsonResponse(
            {
              data: {
                id: "created",
                projectId: "p1",
                ...body,
                lastRunAt: null,
                lastStatus: null,
              },
            },
            201,
          );
        }
        return jsonResponse({
          data: [],
          meta: {
            availableKinds: kinds,
            serverTimezone: "Europe/Paris",
            ciAutofixEnabled: false,
          },
        });
      },
    );

    render(<RoutinesSettings projectId="p1" />);
    await screen.findByText("No routines configured");
    fireEvent.click(screen.getByRole("button", { name: "Add routine" }));

    fireEvent.change(screen.getByTestId("routine-kind-select"), {
      target: { value: "ci_watch" },
    });
    fireEvent.change(screen.getByLabelText("Daily time"), {
      target: { value: "08:45" },
    });
    fireEvent.change(screen.getByLabelText("Configuration (JSON)"), {
      target: { value: '{"intervalMinutes": 10}' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create routine" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/p1/routines",
        expect.objectContaining({ method: "POST" }),
      );
    });
    const postCall = fetchMock.mock.calls.find(
      (call) => call[1]?.method === "POST",
    );
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      kind: "ci_watch",
      enabled: true,
      timeOfDay: "08:45",
      config: { intervalMinutes: 10 },
    });
    expect(await screen.findByTestId("routine-created")).toBeInTheDocument();
  });

  it("toggles and deletes an existing routine through scoped endpoints", async () => {
    const routine = {
      id: "r1",
      projectId: "p1",
      kind: "night_run",
      enabled: true,
      timeOfDay: "23:00",
      config: {},
      lastRunAt: null,
      lastStatus: null,
    };
    fetchMock.mockImplementation(
      async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return jsonResponse({
            data: {
              ...routine,
              enabled: JSON.parse(String(init.body)).enabled,
            },
          });
        }
        if (init?.method === "DELETE") {
          return jsonResponse({ data: { deleted: true } });
        }
        return jsonResponse({
          data: [routine],
          meta: {
            availableKinds: kinds,
            serverTimezone: "Europe/Paris",
            ciAutofixEnabled: false,
          },
        });
      },
    );

    render(<RoutinesSettings projectId="p1" />);
    const enabled = await screen.findByLabelText("Enable Night run");
    const time = screen.getByLabelText("Daily time");
    const config = screen.getByLabelText("Configuration (JSON)");
    fireEvent.change(time, { target: { value: "21:30" } });
    fireEvent.change(config, { target: { value: '{"includeBacklog":true}' } });
    fireEvent.click(enabled);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/p1/routines/r1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    expect(time).toHaveValue("21:30");
    expect(config).toHaveValue('{"includeBacklog":true}');

    fireEvent.click(screen.getByRole("button", { name: "Delete Night run" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/routines/r1", {
        method: "DELETE",
      }),
    );
    expect(
      await screen.findByText("No routines configured"),
    ).toBeInTheDocument();
  });
  it("refreshes routine metadata without replacing an unsaved draft", async () => {
    const routine = { id: "r1", projectId: "p1", kind: "night_run", enabled: true, timeOfDay: "23:00", config: {}, lastRunAt: null, lastStatus: null };
    fetchMock.mockImplementation(async () => jsonResponse({ data: [routine], meta: { availableKinds: kinds } }));
    render(<RoutinesSettings projectId="p1" />);
    const config = await screen.findByLabelText("Configuration (JSON)");
    fireEvent.change(config, { target: { value: '{"includeBacklog":true}' } });
    fireEvent.change(screen.getByLabelText("Daily time"), { target: { value: "20:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());
    expect(config).toHaveValue('{"includeBacklog":true}');
    expect(screen.getByLabelText("Daily time")).toHaveValue("20:00");
  });

  it("does not resurrect a removed routine from an older refresh", async () => {
    const routine = { id: "r1", projectId: "p1", kind: "night_run", enabled: true, timeOfDay: "23:00", config: {}, lastRunAt: null, lastStatus: null };
    fetchMock.mockResolvedValue(jsonResponse({ data: [routine], meta: { availableKinds: kinds } }));
    render(<RoutinesSettings projectId="p1" />);
    await screen.findByLabelText("Daily time");
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: { deleted: true } }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Night run" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await screen.findByText("No routines configured");
    await act(async () => { finish(jsonResponse({ data: [routine], meta: { availableKinds: kinds } })); });
    expect(screen.queryByTestId("routine-r1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("adopts a new server config after the previous compact JSON draft was saved", async () => {
    let routine = { id: "r1", projectId: "p1", kind: "night_run", enabled: true, timeOfDay: "23:00", config: {}, lastRunAt: null, lastStatus: null };
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        routine = { ...routine, ...JSON.parse(String(init.body)) };
        return jsonResponse({ data: routine });
      }
      return jsonResponse({ data: [routine], meta: { availableKinds: kinds } });
    });
    render(<RoutinesSettings projectId="p1" />);
    const config = await screen.findByLabelText("Configuration (JSON)");
    fireEvent.change(config, { target: { value: '{"includeBacklog":true}' } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled());
    routine = { ...routine, config: { includeBacklog: false } };
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(config).toHaveValue(JSON.stringify(routine.config, null, 2)));
  });

  it("updates config when NamedAgentSelect changes on night_run routine", async () => {
    const routine = {
      id: "r1",
      projectId: "p1",
      kind: "night_run",
      enabled: true,
      timeOfDay: "23:00",
      config: { includeBacklog: false },
      lastRunAt: null,
      lastStatus: null,
    };
    fetchMock.mockResolvedValue(jsonResponse({ data: [routine], meta: { availableKinds: kinds } }));
    render(<RoutinesSettings projectId="p1" />);
    const agentInput = await screen.findByTestId("routine-named-agent-select");
    expect(agentInput).toBeInTheDocument();
    fireEvent.change(agentInput, { target: { value: "agent-nightly" } });
    const config = screen.getByLabelText("Configuration (JSON)");
    expect(config).toHaveValue(JSON.stringify({ includeBacklog: false, namedAgentId: "agent-nightly" }, null, 2));
  });

});
