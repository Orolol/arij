import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
import { ControlDeskProvider } from "@/components/ControlDeskProvider";
import { ProjectsProvider } from "@/components/ProjectsProvider";
import { useControlDesk, useDeskInboxSummary, filterDeskPayload } from "@/hooks/useControlDesk";
import { useProjects } from "@/hooks/useProjects";
import { useInbox } from "@/hooks/useInbox";
import type { ControlDeskPayload } from "@/lib/control-desk/types";
const snapshot = { generatedAt: "now", inboxUnreadCount: 7, projects: [], working: [], queued: [], today: {}, yourTurn: { awaitingReply: [], failed: [], conflicts: [], parked: [{ ticketId: "t", epicId: "t", projectId: "p", title: "Ticket", readableId: null, reason: "Pause", at: "now" }] }, readyToLand: [], heldBackCount: 0, upNext: [] } as unknown as ControlDeskPayload;
function Badge() {
  const desk = useDeskInboxSummary();
  const inbox = useInbox({ summaryOnly: true, enabled: !desk.enabled });
  return <output data-testid="badge">{desk.enabled ? desk.unreadCount : inbox.unreadCount}</output>;
}
function Desk() {
  const { data } = useControlDesk();
  return <output data-testid="desk">{data?.generatedAt}</output>;
}
function ProjectList({ id }: { id: string }) {
  const { projects } = useProjects();
  return <output data-testid={id}>{projects[0]?.name}</output>;
}
beforeEach(() => {
  nav.pathname = "/";
  global.fetch = vi.fn(async (input) => ({ ok: true, json: async () => ({ data: String(input) === "/api/projects" ? [{ id: "p", name: "Project" }] : String(input).startsWith("/api/inbox") ? { unreadCount: 4 } : snapshot }) } as Response));
});
describe("shared page resources", () => {
  it("the global badge and desk share one desk read", async () => {
    render(<ControlDeskProvider><Badge /><Desk /></ControlDeskProvider>);
    await waitFor(() => expect(screen.getByTestId("badge")).toHaveTextContent("7"));
    expect(screen.getByTestId("desk")).toHaveTextContent("now");
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/api/control-desk"]);
  });
  it("uses only the lightweight inbox summary outside desk routes", async () => {
    nav.pathname = "/settings";
    render(<ControlDeskProvider><Badge /></ControlDeskProvider>);
    await waitFor(() => expect(screen.getByTestId("badge")).toHaveTextContent("4"));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/api/inbox?summary=1"]);
  });
  it("project list consumers share one request", async () => {
    render(<ProjectsProvider><ProjectList id="one" /><ProjectList id="two" /></ProjectsProvider>);
    await waitFor(() => expect(screen.getByTestId("two")).toHaveTextContent("Project"));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/api/projects"]);
  });
  it("scopes parked tickets while preserving the global badge count", () => {
    expect(filterDeskPayload(snapshot, "other")).toMatchObject({ inboxUnreadCount: 7, yourTurn: { parked: [] } });
  });
});
