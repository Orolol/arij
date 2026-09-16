import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, useCallback, useImperativeHandle, useState, type ReactNode } from "react";
import { installMockEventSource } from "./helpers/event-source-mock";

// Mock EventSource (used by useProjectEvents)
installMockEventSource();

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useAgentPolling", () => ({
  useAgentPolling: () => ({ activities: [] }),
}));

vi.mock("@/hooks/useBatchSelection", () => ({
  useBatchSelection: () => {
    const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>([]);
    const userSelected = new Set(selectedTicketIds);
    const autoIncluded = new Set<string>();
    const allSelected = new Set(selectedTicketIds);

    const toggle = useCallback((ticketId: string) => {
      setSelectedTicketIds((prev) =>
        prev.includes(ticketId)
          ? prev.filter((id) => id !== ticketId)
          : [...prev, ticketId]
      );
    }, []);

    const clear = useCallback(() => {
      setSelectedTicketIds([]);
    }, []);

    return {
      allSelected,
      userSelected,
      autoIncluded,
      selectedTicketIds,
      loading: false,
      selectPrimary: (ticketId: string) => setSelectedTicketIds([ticketId]),
      setSelectedTicketIds: (ticketIds: string[]) => setSelectedTicketIds(ticketIds),
      toggle,
      clear,
      isAutoIncluded: (id: string) => autoIncluded.has(id),
      isUserSelected: (id: string) => userSelected.has(id),
    };
  },
}));

// The board is gone; the route renders the project-filtered control desk.
// `onOpenTicket` is the desk's plain ticket click and `onToggleSelect` its
// ⌘/Ctrl-click — the same two gestures the board exposed, same page contract.
vi.mock("@/components/desk/NowDesk", () => ({
  NowDesk: ({
    onOpenTicket,
    onToggleSelect,
    selectedEpicIds,
  }: {
    onOpenTicket: (id: string) => void;
    onToggleSelect?: (id: string) => void;
    selectedEpicIds: ReadonlySet<string>;
  }) => (
    <div data-testid="board">
      <button data-testid="primary-epic-1" onClick={() => onOpenTicket("epic-1")}>
        Open Epic 1
      </button>
      <button data-testid="primary-epic-2" onClick={() => onOpenTicket("epic-2")}>
        Open Epic 2
      </button>
      <button data-testid="toggle-epic-1" onClick={() => onToggleSelect?.("epic-1")}>
        Toggle Epic 1
      </button>
      <button data-testid="toggle-epic-2" onClick={() => onToggleSelect?.("epic-2")}>
        Toggle Epic 2
      </button>
      <span data-testid="board-selected-count">{selectedEpicIds.size}</span>
    </div>
  ),
}));

// The detail modal has its own lifetime; batch selection leaves the desk usable.
vi.mock("@/components/ticket/TicketOverlay", () => ({
  TicketOverlay: ({
    epicId,
    onClose,
  }: {
    epicId: string;
    onClose: () => void;
  }) => (
    <div data-testid="ticket-overlay">
      Detail: {epicId}
      <button data-testid="ticket-overlay-close" onClick={onClose}>
        Close
      </button>
    </div>
  ),
}));

vi.mock("@/components/chat/UnifiedChatPanel", () => ({
  UnifiedChatPanel: forwardRef(
    function UnifiedChatPanelMock({ children }: { children: ReactNode }, ref) {
      useImperativeHandle(ref, () => ({
        openNewEpic: vi.fn(),
      }));

      return (
        <div data-testid="unified-chat-panel">
          <div>{children}</div>
        </div>
      );
    }
  ),
}));


vi.mock("@/components/shared/NamedAgentSelect", () => ({
  NamedAgentSelect: () => <div data-testid="named-agent-select" />,
}));

vi.mock("@/components/kanban/BugCreateDialog", () => ({
  BugCreateDialog: () => null,
}));

vi.mock("@/components/auto-mode/AutoModeToggle", () => ({
  AutoModeToggle: () => null,
}));
vi.mock("@/components/kanban/RefinementButton", () => ({
  RefinementButton: () => null,
}));

import KanbanPage from "@/app/projects/[projectId]/page";

describe("project desk ticket navigation and batch selection", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("opens a ticket without creating a batch selection", () => {
    render(<KanbanPage />);
    fireEvent.click(screen.getByTestId("primary-epic-1"));
    expect(screen.getByText("Detail: epic-1")).toBeInTheDocument();
    expect(screen.getByTestId("board-selected-count")).toHaveTextContent("0");
  });

  it("selects several tickets without a modal blocking the next click", () => {
    render(<KanbanPage />);
    fireEvent.click(screen.getByTestId("toggle-epic-1"));
    expect(screen.queryByTestId("ticket-overlay")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("toggle-epic-2"));
    expect(screen.getByText("2 epics selected")).toBeInTheDocument();
    expect(screen.queryByTestId("ticket-overlay")).not.toBeInTheDocument();
  });

  it("preserves a batch while inspecting and closing a different ticket", () => {
    render(<KanbanPage />);
    fireEvent.click(screen.getByTestId("toggle-epic-1"));
    fireEvent.click(screen.getByTestId("primary-epic-2"));
    expect(screen.getByText("Detail: epic-2")).toBeInTheDocument();
    expect(screen.getByText("1 epic selected")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ticket-overlay-close"));
    expect(screen.queryByTestId("ticket-overlay")).not.toBeInTheDocument();
    expect(screen.getByText("1 epic selected")).toBeInTheDocument();
    expect(screen.getByTestId("board")).toBeInTheDocument();
  });

  it("clears a batch without closing the inspected ticket", () => {
    render(<KanbanPage />);
    fireEvent.click(screen.getByTestId("toggle-epic-1"));
    fireEvent.click(screen.getByTestId("primary-epic-2"));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("board-selected-count")).toHaveTextContent("0");
    expect(screen.getByText("Detail: epic-2")).toBeInTheDocument();
  });
});
