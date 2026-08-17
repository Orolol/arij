/**
 * Project board wiring for night runs: the header-bar button (available
 * without any selection), the success toast, and the
 * `?nightRun=<runId>` deep link that opens the morning summary — the same
 * shape as the existing `?ticket=` link.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}
(globalThis as Record<string, unknown>).EventSource = MockEventSource;

const routerReplace = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj1" }),
  useRouter: () => ({ replace: routerReplace }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/hooks/useAgentPolling", () => ({
  useAgentPolling: () => ({ activities: [] }),
}));

vi.mock("@/hooks/useBatchSelection", () => ({
  useBatchSelection: () => {
    const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
    const clear = useCallback(() => setSelectedTicketIds([]), []);
    return {
      allSelected: new Set(selectedTicketIds),
      userSelected: new Set(selectedTicketIds),
      autoIncluded: new Set<string>(),
      selectedTicketIds,
      loading: false,
      setSelectedTicketIds,
      toggle: vi.fn(),
      clear,
      isAutoIncluded: () => false,
      isUserSelected: () => false,
    };
  },
}));

vi.mock("@/components/kanban/Board", () => ({
  Board: () => <div data-testid="board" />,
}));
vi.mock("@/components/kanban/EpicDetail", () => ({ EpicDetail: () => null }));
vi.mock("@/components/monitor/AgentMonitor", () => ({ AgentMonitor: () => null }));
vi.mock("@/components/shared/NamedAgentSelect", () => ({
  NamedAgentSelect: () => null,
}));
vi.mock("@/components/chat/UnifiedChatPanel", () => ({
  UnifiedChatPanel: forwardRef(({ children }: { children: ReactNode }, ref) => {
    useImperativeHandle(ref, () => ({
      openChat: vi.fn(),
      openNewEpic: vi.fn(),
      collapse: vi.fn(),
      hide: vi.fn(),
    }));
    return <div data-testid="unified-chat-panel">{children}</div>;
  }),
}));

// Stubs for the two night dialogs: the dialogs have their own tests, here we
// only assert the page opens them with the right inputs.
let startedHandler: ((r: { message: string }) => void) | null = null;
vi.mock("@/components/night/NightRunDialog", () => ({
  NightRunDialog: ({
    open,
    onStarted,
  }: {
    open: boolean;
    onStarted?: (r: { message: string }) => void;
  }) => {
    startedHandler = onStarted ?? null;
    return open ? <div data-testid="night-dialog-open" /> : null;
  },
}));
vi.mock("@/components/night/NightRunSummaryDialog", () => ({
  NightRunSummaryDialog: ({
    open,
    runId,
  }: {
    open: boolean;
    runId: string | null;
  }) =>
    open ? <div data-testid="night-summary-open">{runId}</div> : null,
}));

import KanbanPage from "@/app/projects/[projectId]/page";

describe("Project board — night run wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams();
    startedHandler = null;
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
  });

  it("offers the Night run button with nothing selected", async () => {
    render(<KanbanPage />);
    expect(await screen.findByTestId("night-run-button")).toBeInTheDocument();
    expect(screen.queryByTestId("night-dialog-open")).not.toBeInTheDocument();
  });

  it("opens the confirm dialog on click", async () => {
    render(<KanbanPage />);
    fireEvent.click(await screen.findByTestId("night-run-button"));
    expect(screen.getByTestId("night-dialog-open")).toBeInTheDocument();
  });

  it("toasts the launch message the dialog reports", async () => {
    render(<KanbanPage />);
    fireEvent.click(await screen.findByTestId("night-run-button"));

    act(() => {
      startedHandler?.({ message: "Night run started — wave 1/3, 5 epics" });
    });

    await waitFor(() =>
      expect(
        screen.getByText("Night run started — wave 1/3, 5 epics")
      ).toBeInTheDocument()
    );
  });

  it("opens the summary from ?nightRun= and strips the param", async () => {
    searchParams = new URLSearchParams("nightRun=night_abc");
    render(<KanbanPage />);

    await waitFor(() =>
      expect(screen.getByTestId("night-summary-open")).toHaveTextContent(
        "night_abc"
      )
    );
    expect(routerReplace).toHaveBeenCalledWith("/projects/proj1");
  });

  it("does not open the summary without the param", async () => {
    render(<KanbanPage />);
    await screen.findByTestId("night-run-button");
    expect(screen.queryByTestId("night-summary-open")).not.toBeInTheDocument();
  });

  it("offers a shortcut to the latest night run and opens its summary", async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/build/night-runs")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { runId: "night_last", state: "finished", interrupted: false },
              { runId: "night_older", state: "finished", interrupted: false },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ data: {} }) };
    }) as unknown as typeof fetch;

    render(<KanbanPage />);

    const shortcut = await screen.findByTestId("night-last-run-button");
    expect(shortcut).toHaveTextContent("Last night run");
    fireEvent.click(shortcut);

    expect(screen.getByTestId("night-summary-open")).toHaveTextContent(
      "night_last"
    );
  });

  it("labels the shortcut as in progress while a run is still going", async () => {
    global.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/build/night-runs")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { runId: "night_done", state: "finished", interrupted: false },
              { runId: "night_live", state: "running", interrupted: false },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({ data: {} }) };
    }) as unknown as typeof fetch;

    render(<KanbanPage />);

    const shortcut = await screen.findByTestId("night-last-run-button");
    expect(shortcut).toHaveTextContent("Night run in progress");
    fireEvent.click(shortcut);
    expect(screen.getByTestId("night-summary-open")).toHaveTextContent(
      "night_live"
    );
  });

  it("hides the shortcut when the project never ran a night", async () => {
    render(<KanbanPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(
      screen.queryByTestId("night-last-run-button")
    ).not.toBeInTheDocument();
  });
});
