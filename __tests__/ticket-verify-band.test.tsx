/**
 * VERIFICATION in the ticket overlay.
 *
 * `useEpicDetail` has fetched `GET …/epics/:id/verify` since the deterministic
 * stage landed, but `useTicketOverlayData` destructured everything EXCEPT the
 * report, so no component ever received it: a project with `verify_commands`
 * got a persisted pass/fail verdict, a `ticket:updated` event carrying
 * `verifyStatus`, and a merge gate acting on it — and no surface showing the
 * failing command or its output.
 *
 * These cases pin the band the overlay now draws: the verdict word, every
 * command's name / exit code / duration / tail, and the manual re-run the
 * route already supported.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";

import { TicketOverlay } from "@/components/ticket/TicketOverlay";
import type { VerificationReport } from "@/lib/verify/verify-constants";

const mockUseEpicDetail = vi.hoisted(() => vi.fn());
const mockUseTicketComments = vi.hoisted(() => vi.fn());
const mockUseAgentDispatch = vi.hoisted(() => vi.fn());
const mockUseEpicPr = vi.hoisted(() => vi.fn());
const mockUseGitHubConfig = vi.hoisted(() => vi.fn());
const mockUseEpicDependencies = vi.hoisted(() => vi.fn());
const mockUseProjectEpicsList = vi.hoisted(() => vi.fn());
const mockUseNamedAgentsList = vi.hoisted(() => vi.fn());
const mockFindUnifiedSession = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useEpicDetail", () => ({
  useEpicDetail: (...args: unknown[]) => mockUseEpicDetail(...args),
}));
vi.mock("@/hooks/useTicketComments", () => ({
  useTicketComments: (...args: unknown[]) => mockUseTicketComments(...args),
}));
vi.mock("@/hooks/useAgentDispatch", () => ({
  useAgentDispatch: (...args: unknown[]) => mockUseAgentDispatch(...args),
}));
vi.mock("@/hooks/useEpicPr", () => ({
  useEpicPr: (...args: unknown[]) => mockUseEpicPr(...args),
}));
vi.mock("@/hooks/useGitHubConfig", () => ({
  useGitHubConfig: (...args: unknown[]) => mockUseGitHubConfig(...args),
}));
vi.mock("@/hooks/useEpicDependencies", () => ({
  useEpicDependencies: (...args: unknown[]) => mockUseEpicDependencies(...args),
}));
vi.mock("@/hooks/useProjectEpicsList", () => ({
  useProjectEpicsList: (...args: unknown[]) => mockUseProjectEpicsList(...args),
}));
vi.mock("@/hooks/useNamedAgentsList", () => ({
  useNamedAgentsList: (...args: unknown[]) => mockUseNamedAgentsList(...args),
}));
vi.mock("@/hooks/useProjectEvents", () => ({
  useProjectEvents: () => ({ status: "connected", pollTick: 0 }),
}));
vi.mock("@/lib/agent-sessions/session-list", () => ({
  findUnifiedSession: (...args: unknown[]) => mockFindUnifiedSession(...args),
}));
vi.mock("@/components/review/DiffViewer", () => ({
  DiffViewer: () => <div data-testid="diff-viewer" />,
}));
vi.mock("@/components/shared/AgentDispatchDialog", () => ({
  AgentDispatchDialog: () => null,
}));
vi.mock("@/components/chat/MarkdownContent", () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children }: { children: ReactNode }) => (
    <button type="button" role="menuitem">
      {children}
    </button>
  ),
}));

const PASSING_REPORT: VerificationReport = {
  id: "verify-1",
  projectId: "proj-1",
  epicId: "epic-1",
  agentSessionId: "sess-1",
  status: "pass",
  startedAt: "2026-09-08T12:00:00.000Z",
  finishedAt: "2026-09-08T12:00:04.000Z",
  commands: [
    {
      name: "test",
      command: "npm test",
      exitCode: 0,
      durationMs: 2_400,
      tail: "61 tests passed\n",
    },
    {
      name: "lint",
      command: "npm run lint",
      exitCode: 0,
      durationMs: 640,
      tail: "lint clean\n",
    },
  ],
};

const FAILING_REPORT: VerificationReport = {
  ...PASSING_REPORT,
  id: "verify-2",
  status: "fail",
  commands: [
    {
      name: "build",
      command: "npm run build",
      exitCode: 2,
      durationMs: 31_200,
      tail: "Type error in app/page.tsx:41",
    },
    {
      name: "typecheck",
      // A command that timed out or never started has no exit code at all —
      // rendering that as `exit 0` would read as a pass.
      command: "npx tsc --noEmit",
      exitCode: null,
      durationMs: 600_000,
      tail: "timed out",
    },
  ],
};

let setVerificationReport: ReturnType<typeof vi.fn>;

function epicFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "epic-1",
    title: "Deterministic verification",
    description: null,
    priority: 2,
    status: "review",
    branchName: "feature/epic-1",
    prNumber: null,
    prUrl: null,
    prStatus: null,
    type: "feature",
    linkedEpicId: null,
    images: null,
    readableId: "ARJ-300",
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function setDetail(report: VerificationReport | null) {
  mockUseEpicDetail.mockReturnValue({
    epic: epicFixture(),
    userStories: [],
    loading: false,
    updateEpic: vi.fn().mockResolvedValue({ ok: true }),
    refresh: vi.fn(),
    setPolling: vi.fn(),
    verificationReport: report,
    setVerificationReport,
  });
}

function setDispatch(overrides: Record<string, unknown> = {}) {
  mockUseAgentDispatch.mockReturnValue({
    activeSession: null,
    dispatching: false,
    isRunning: false,
    sendToDev: vi.fn(),
    sendToReview: vi.fn(),
    sendToGrading: vi.fn(),
    resolveMerge: vi.fn(),
    refreshSessions: vi.fn(),
    ...overrides,
  });
}

function renderSubject(overrides?: Partial<ComponentProps<typeof TicketOverlay>>) {
  return render(
    <TicketOverlay
      projectId="proj-1"
      epicId="epic-1"
      open
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

/** The command row for one configured command, pinned by its name. */
function commandRow(name: string) {
  return screen.getByTestId("ticket-verify-band").querySelector<HTMLElement>(
    `[data-testid="ticket-verify-command"][data-name="${name}"]`,
  );
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.endsWith("/activity") ? { data: [] } : { data: { name: "Arij" } };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  setVerificationReport = vi.fn();
  setDetail(null);
  mockUseTicketComments.mockReturnValue({
    comments: [],
    loading: false,
    addComment: vi.fn(),
  });
  setDispatch();
  mockUseEpicPr.mockReturnValue({
    pr: null,
    loading: false,
    error: null,
    createPr: vi.fn(),
    syncPr: vi.fn(),
  });
  mockUseGitHubConfig.mockReturnValue({ isConfigured: false });
  mockUseEpicDependencies.mockReturnValue({ predecessors: [], successors: [] });
  mockUseProjectEpicsList.mockReturnValue({ epics: [] });
  mockUseNamedAgentsList.mockReturnValue({ agents: [] });
  mockFindUnifiedSession.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */

describe("the ticket overlay's verification band", () => {
  it("renders the newest report the data hook fetched", async () => {
    setDetail(PASSING_REPORT);
    renderSubject();

    const band = await screen.findByTestId("ticket-verify-band");
    expect(within(band).getByTestId("ticket-verify-report")).toBeInTheDocument();
    // The verdict is a WORD, per the Piscine rule that colour never carries
    // state.
    expect(band).toHaveTextContent("VERIFIED");
  });

  it("shows every command's name, exit code and duration", async () => {
    setDetail(PASSING_REPORT);
    renderSubject();

    await screen.findByTestId("ticket-verify-band");

    const test = commandRow("test");
    expect(test).not.toBeNull();
    expect(test).toHaveTextContent("test");
    expect(test).toHaveTextContent("npm test");
    expect(test).toHaveTextContent("exit 0");
    expect(test).toHaveTextContent("2.4 s");

    const lint = commandRow("lint");
    expect(lint).toHaveTextContent("exit 0");
    expect(lint).toHaveTextContent("640 ms");
  });

  it("names a failed run and keeps the failing command's tail on screen", async () => {
    setDetail(FAILING_REPORT);
    renderSubject();

    const band = await screen.findByTestId("ticket-verify-band");
    expect(band).toHaveTextContent("FAILED");

    const build = commandRow("build");
    expect(build).toHaveTextContent("exit 2");
    // A failing command's output is what the user opened the ticket for: it is
    // expanded already, not hidden behind a toggle.
    expect(build).toHaveTextContent("Type error in app/page.tsx:41");
  });

  it("never renders a missing exit code as a passing zero", async () => {
    setDetail(FAILING_REPORT);
    renderSubject();

    await screen.findByTestId("ticket-verify-band");
    const timedOut = commandRow("typecheck");
    expect(timedOut).not.toBeNull();
    expect(timedOut!.textContent).not.toContain("exit 0");
    expect(timedOut).toHaveTextContent("exit —");
  });

  it("reveals a passing command's tail on demand", async () => {
    setDetail(PASSING_REPORT);
    renderSubject();

    await screen.findByTestId("ticket-verify-band");
    expect(screen.queryByText(/61 tests passed/)).toBeNull();

    fireEvent.click(within(commandRow("test")!).getByTestId("ticket-verify-output-toggle"));
    expect(screen.getByText(/61 tests passed/)).toBeInTheDocument();
  });

  it("runs verification manually and installs the report the route returns", async () => {
    setDetail(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/verify") && init?.method === "POST") {
        return new Response(JSON.stringify({ data: PASSING_REPORT }), { status: 200 });
      }
      return new Response(
        JSON.stringify(url.endsWith("/activity") ? { data: [] } : { data: { name: "Arij" } }),
        { status: 200 },
      );
    });

    renderSubject();
    fireEvent.click(await screen.findByTestId("ticket-verify-run"));

    await waitFor(() => {
      expect(setVerificationReport).toHaveBeenCalledWith(PASSING_REPORT);
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/projects/proj-1/epics/epic-1/verify",
      { method: "POST" },
    );
  });

  it("surfaces the route's own refusal instead of a generic failure", async () => {
    setDetail(null);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/verify") && init?.method === "POST") {
        return new Response(
          JSON.stringify({
            error:
              "Verification requires an existing epic worktree. Build or review this ticket first.",
          }),
          { status: 409 },
        );
      }
      return new Response(
        JSON.stringify(url.endsWith("/activity") ? { data: [] } : { data: { name: "Arij" } }),
        { status: 200 },
      );
    });

    renderSubject();
    fireEvent.click(await screen.findByTestId("ticket-verify-run"));

    expect(await screen.findByTestId("ticket-verify-error")).toHaveTextContent(
      "Verification requires an existing epic worktree.",
    );
    expect(setVerificationReport).not.toHaveBeenCalled();
  });

  it("refuses the manual run while an agent occupies the epic", async () => {
    // The route answers 409 in this state; disabling the pill says so before
    // the request rather than after it.
    setDetail(PASSING_REPORT);
    setDispatch({ isRunning: true });
    renderSubject();

    expect(await screen.findByTestId("ticket-verify-run")).toBeDisabled();
  });

  it("collapses to its label line and the run action when nothing ran yet", async () => {
    setDetail(null);
    renderSubject();

    const band = await screen.findByTestId("ticket-verify-band");
    expect(within(band).queryByTestId("ticket-verify-report")).toBeNull();
    expect(within(band).getByTestId("ticket-verify-run")).toBeInTheDocument();
  });
});
