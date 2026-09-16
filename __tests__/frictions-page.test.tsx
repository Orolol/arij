import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
}));

vi.mock("@/components/kanban/EpicCreateDialog", () => ({
  EpicCreateDialog: (props: {
    open: boolean;
    frictionId?: string;
    initialDraft?: { title: string; description: string };
    onCreated?: (id: string) => void;
  }) =>
    props.open ? (
      <div data-testid="conversion-dialog">
        <span>{props.frictionId}</span>
        <span>{props.initialDraft?.title}</span>
        <span>{props.initialDraft?.description}</span>
        <button type="button" onClick={() => props.onCreated?.("created-ticket")}>Confirm conversion</button>
      </div>
    ) : null,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import ProjectFrictionsPage from "@/app/projects/[projectId]/frictions/page";

const baseRows = [
  {
    id: "low",
    projectId: "proj-1",
    epicId: null,
    agentSessionId: "session-low",
    category: "flaky_test",
    description: "Occasional timeout",
    filePath: "__tests__/slow.test.ts",
    occurrences: 1,
    status: "new",
    createdAt: "2026-08-24T10:00:00.000Z",
  },
  {
    id: "high",
    projectId: "proj-1",
    epicId: null,
    agentSessionId: "session-high",
    category: "broken_tooling",
    description: "The check script exits without diagnostics",
    filePath: "scripts/check.sh",
    occurrences: 7,
    status: "triaged",
    createdAt: "2026-08-25T10:00:00.000Z",
  },
  {
    id: "converted",
    projectId: "proj-1",
    epicId: "epic-created",
    agentSessionId: "session-old",
    category: "misleading_docs",
    description: "Old documentation problem",
    filePath: "README.md",
    occurrences: 12,
    status: "converted",
    createdAt: "2026-08-23T10:00:00.000Z",
  },
] as const;

function installFetch() {
  let rows = baseRows.map((row) => ({ ...row, status: row.status as string }));
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "PATCH") {
      const id = url.split("/").at(-1);
      rows = rows.map((row) =>
        row.id === id ? { ...row, status: "dismissed" } : row,
      );
      return { ok: true, json: async () => ({ data: rows.find((row) => row.id === id) }) };
    }
    return {
      ok: true,
      json: async () => ({
        data: {
          frictions: rows,
          openCount: rows.filter((row) => ["new", "triaged"].includes(row.status)).length,
        },
      }),
    };
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  vi.restoreAllMocks();
  installFetch();
});

describe("project Frictions page", () => {
  it("keeps another friction locked when the first concurrent dismissal finishes", async () => {
    let releaseLow!: (response: Response) => void;
    let releaseHigh!: (response: Response) => void;
    const low = new Promise<Response>((resolve) => { releaseLow = resolve; });
    const high = new Promise<Response>((resolve) => { releaseHigh = resolve; });
    const fetchMock = vi.fn((url: string, init?: RequestInit) => init?.method === "PATCH"
      ? url.endsWith("/low") ? low : high
      : Promise.resolve(new Response(JSON.stringify({ data: { frictions: baseRows, openCount: 2 } }))));
    global.fetch = fetchMock as typeof fetch;
    render(<ProjectFrictionsPage />);
    const lowCard = await screen.findByTestId("friction-low");
    const highCard = screen.getByTestId("friction-high");
    fireEvent.click(within(lowCard).getByRole("button", { name: "Dismiss" }));
    fireEvent.click(within(highCard).getByRole("button", { name: "Dismiss" }));
    await act(async () => { releaseLow(new Response(JSON.stringify({ error: "Low refused" }), { status: 409 })); });
    expect(within(highCard).getByRole("button", { name: "Dismiss" })).toBeDisabled();
    fireEvent.click(within(highCard).getByRole("button", { name: "Dismiss" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2);
    await act(async () => { releaseHigh(new Response(JSON.stringify({ error: "High refused" }), { status: 409 })); });
    expect(within(highCard).getByRole("button", { name: "Dismiss" })).toBeEnabled();
  });

  it("offers retry after an initial read failure without claiming zero frictions", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(new Response("offline", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { frictions: baseRows, openCount: 2 } })));
    render(<ProjectFrictionsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to load frictions");
    expect(screen.queryByText("0 open")).not.toBeInTheDocument();
    expect(screen.queryByText("No frictions match these filters.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByTestId("friction-high");
    expect(screen.getByText("2 open")).toBeInTheDocument();
  });

  it("sorts open reports by occurrences and filters category and status", async () => {
    render(<ProjectFrictionsPage />);
    await screen.findByTestId("friction-high");

    let cards = within(screen.getByTestId("friction-list")).getAllByTestId(/^friction-/);
    expect(cards.map((card) => card.dataset.testid)).toEqual([
      "friction-high",
      "friction-low",
    ]);

    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "flaky_test" },
    });
    expect(screen.getByTestId("friction-low")).toBeInTheDocument();
    expect(screen.queryByTestId("friction-high")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "all" } });
    cards = within(screen.getByTestId("friction-list")).getAllByTestId(/^friction-/);
    expect(cards.map((card) => card.dataset.testid)).toEqual([
      "friction-converted",
      "friction-high",
      "friction-low",
    ]);
  });

  it("opens the existing epic form with an editable friction-derived draft", async () => {
    render(<ProjectFrictionsPage />);
    const card = await screen.findByTestId("friction-high");

    fireEvent.click(within(card).getByRole("button", { name: "Create ticket" }));

    const dialog = screen.getByTestId("conversion-dialog");
    expect(dialog).toHaveTextContent("high");
    expect(dialog).toHaveTextContent("Broken tooling: scripts/check.sh");
    expect(dialog).toHaveTextContent("Reported 7 times by coding agents.");
  });

  it("dismisses an open row and refreshes the open count", async () => {
    render(<ProjectFrictionsPage />);
    const card = await screen.findByTestId("friction-low");

    fireEvent.click(within(card).getByRole("button", { name: /Dismiss/ }));

    await waitFor(() => expect(screen.queryByTestId("friction-low")).not.toBeInTheDocument());
    expect(screen.getByText("1 open")).toBeInTheDocument();
  });
});
