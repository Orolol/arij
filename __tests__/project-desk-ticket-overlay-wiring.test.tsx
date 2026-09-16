/**
 * `/projects/:id` drives its ticket overlay from page state, so the overlay's
 * navigation has to come back through the page (audit 2026-09-10):
 * - #120 a dependency chip swaps the open ticket;
 * - #133 the desk's CONFLICT "Diff" opens the ticket on its diff, and a later
 *   plain open is the ticket again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, type ReactNode } from "react";

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}
(globalThis as Record<string, unknown>).EventSource = MockEventSource;

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj1" }),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects/proj1",
}));
vi.mock("@/hooks/useBatchSelection", () => ({
  useBatchSelection: () => ({
    allSelected: new Set<string>(),
    userSelected: new Set<string>(),
    autoIncluded: new Set<string>(),
    selectedTicketIds: [],
    loading: false,
    setSelectedTicketIds: vi.fn(),
    toggle: vi.fn(),
    clear: vi.fn(),
    isAutoIncluded: () => false,
    isUserSelected: () => false,
  }),
}));

type OpenOptions = { view?: "ticket" | "diff" };
vi.mock("@/components/desk/NowDesk", () => ({
  NowDesk: ({ onOpenTicket }: { onOpenTicket: (id: string, options?: OpenOptions) => void }) => (
    <div>
      <button type="button" onClick={() => onOpenTicket("T1")}>open T1</button>
      <button type="button" onClick={() => onOpenTicket("T1", { view: "diff" })}>diff T1</button>
    </div>
  ),
}));
vi.mock("@/components/desk/ProjectBatchToolbar", () => ({ ProjectBatchToolbar: () => null }));
vi.mock("@/components/desk/ProjectDeskDialogs", () => ({ ProjectDeskDialogs: () => null }));
vi.mock("@/components/auto-mode/AutoModeToggle", () => ({ AutoModeToggle: () => null }));
vi.mock("@/components/kanban/RefinementButton", () => ({ RefinementButton: () => null }));
vi.mock("@/components/chat/UnifiedChatPanel", () => ({
  UnifiedChatPanel: forwardRef(function UnifiedChatPanelMock({ children }: { children: ReactNode }) {
    return <div>{children}</div>;
  }),
}));
vi.mock("@/components/ticket/TicketOverlay", () => ({
  TicketOverlay: ({
    epicId,
    initialView,
    onOpenTicket,
    onClose,
  }: {
    epicId: string;
    initialView?: string;
    onOpenTicket?: (id: string) => void;
    onClose: () => void;
  }) => (
    <div data-testid="ticket-overlay" data-view={initialView ?? "ticket"}>
      <span data-testid="ticket-overlay-epic">{epicId}</span>
      <button type="button" onClick={() => onOpenTicket?.("T2")}>chip T2</button>
      <button type="button" onClick={onClose}>close</button>
    </div>
  ),
}));

import ProjectDeskPage from "@/app/projects/[projectId]/page";

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
});

describe("project desk — overlay navigation", () => {
  it("swaps the open ticket when a dependency chip is clicked", () => {
    render(<ProjectDeskPage />);
    fireEvent.click(screen.getByRole("button", { name: "open T1" }));
    fireEvent.click(screen.getByRole("button", { name: "chip T2" }));
    expect(screen.getByTestId("ticket-overlay-epic")).toHaveTextContent(/^T2$/);
    expect(screen.getByTestId("ticket-overlay")).toHaveAttribute("data-view", "ticket");
  });

  it("opens a CONFLICT row's ticket on the diff, and a plain open on the ticket", () => {
    render(<ProjectDeskPage />);
    fireEvent.click(screen.getByRole("button", { name: "diff T1" }));
    expect(screen.getByTestId("ticket-overlay")).toHaveAttribute("data-view", "diff");

    fireEvent.click(screen.getByRole("button", { name: "close" }));
    fireEvent.click(screen.getByRole("button", { name: "open T1" }));
    expect(screen.getByTestId("ticket-overlay")).toHaveAttribute("data-view", "ticket");
  });
});
