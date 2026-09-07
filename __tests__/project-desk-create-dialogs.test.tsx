import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
  type ReactNode,
} from "react";

/**
 * The two creation dialogs on `/projects/:id` share the desk composer's
 * contract: a success toast through the page's ToastStack, then the created
 * ticket's overlay. Both dialogs are the real components here — what is
 * pinned is the page's handler, from the route the dialog posts to down to
 * the overlay it opens — so a dialog that stops handing its id to the page
 * fails this file, not only its own.
 */

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}
(globalThis as Record<string, unknown>).EventSource = MockEventSource;

/** The query string the page reads; each test sets it before rendering. */
const nav = vi.hoisted(() => ({ search: new URLSearchParams() }));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => nav.search,
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
          : [...prev, ticketId],
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

vi.mock("@/components/desk/NowDesk", () => ({
  NowDesk: () => <div data-testid="board" />,
}));

// The overlay's own tree is not under test; what matters is which ticket the
// page asks it to show.
vi.mock("@/components/ticket/TicketOverlay", () => ({
  TicketOverlay: ({ epicId }: { epicId: string }) => (
    <div data-testid="ticket-overlay">Detail: {epicId}</div>
  ),
}));

vi.mock("@/components/chat/UnifiedChatPanel", () => ({
  UnifiedChatPanel: forwardRef(function UnifiedChatPanelMock(
    { children }: { children: ReactNode },
    ref,
  ) {
    useImperativeHandle(ref, () => ({
      openChat: vi.fn(),
      openNewEpic: vi.fn(),
      collapse: vi.fn(),
      hide: vi.fn(),
    }));
    return <div data-testid="unified-chat-panel">{children}</div>;
  }),
}));

vi.mock("@/components/shared/NamedAgentSelect", () => ({
  NamedAgentSelect: () => <div data-testid="named-agent-select" />,
}));

vi.mock("@/components/auto-mode/AutoModeToggle", () => ({
  AutoModeToggle: () => null,
}));

vi.mock("@/components/kanban/RefinementButton", () => ({
  RefinementButton: () => null,
}));

import ProjectDeskPage from "@/app/projects/[projectId]/page";

/** Answers the two creation routes; everything else gets an empty list. */
function mockFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST" && url === "/api/projects/proj-1/bugs") {
      return { ok: true, json: async () => ({ data: { id: "bug-1" } }) };
    }
    if (method === "POST" && url === "/api/projects/proj-1/epics") {
      return {
        ok: true,
        json: async () => ({ data: { id: "epic-1", userStoriesCreated: 0 } }),
      };
    }
    return { ok: true, json: async () => ({ data: [] }) };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("project desk creation dialogs", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    nav.search = new URLSearchParams();
  });

  it("confirms a created bug with a status toast and opens its ticket", async () => {
    const fetchMock = mockFetch();
    nav.search = new URLSearchParams("panel=new-bug");
    render(<ProjectDeskPage />);

    fireEvent.change(screen.getByPlaceholderText("Bug title..."), {
      target: { value: "App crashes on save" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Bug" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/proj-1/bugs",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    const toast = await screen.findByTestId("board-toast");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveTextContent("Bug created");

    await waitFor(() =>
      expect(screen.getByTestId("ticket-overlay")).toHaveTextContent("Detail: bug-1"),
    );
  });

  it("confirms a created epic with a status toast and opens its ticket", async () => {
    const fetchMock = mockFetch();
    nav.search = new URLSearchParams("panel=new-epic-manual");
    render(<ProjectDeskPage />);

    fireEvent.change(screen.getByTestId("epic-title-input"), {
      target: { value: "Direct epic" },
    });
    fireEvent.click(screen.getByTestId("epic-create-submit"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/proj-1/epics",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    const toast = await screen.findByTestId("board-toast");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveTextContent("Epic created");

    await waitFor(() =>
      expect(screen.getByTestId("ticket-overlay")).toHaveTextContent("Detail: epic-1"),
    );
  });
});
