import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import GitSyncPage from "@/app/projects/[projectId]/git-sync/page";

// Radix tooltips need a provider + hover to reveal their content; render the
// content inline instead so the freshness tooltip copy is directly assertable.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
}));

vi.mock("@/hooks/useNamedAgentsList", () => ({
  useNamedAgentsList: () => ({ agents: [], loading: false }),
}));

vi.mock("@/components/shared/NamedAgentSelect", () => ({
  NamedAgentSelect: (props: { value: string | null; onChange: (v: string) => void }) => (
    <select data-testid="named-agent-select" value={props.value || ""} onChange={(e) => props.onChange(e.target.value)}>
      <option value="">Default</option>
    </select>
  ),
}));

vi.mock("@/components/shared/SessionPicker", () => ({
  SessionPicker: () => <div data-testid="session-picker" />,
}));

describe("GitSyncPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders pull and push actions with branch status", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            branch: "main",
            remote: "origin",
            ahead: 1,
            behind: 2,
            hasRemoteBranch: true,
          },
        }),
      } as Response);

    render(<GitSyncPage />);

    await waitFor(() => {
      expect(screen.getByText("Ahead:")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Pull" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Push" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("shows how long ago the remote was fetched next to the counters", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          branch: "main",
          remote: "origin",
          ahead: 1,
          behind: 2,
          hasRemoteBranch: true,
          lastFetchedAt: Date.now() - 7 * 60 * 1000,
          lastFetchError: null,
        },
      }),
    } as Response);

    render(<GitSyncPage />);

    await waitFor(() => {
      expect(screen.getByText("Synced 7m ago")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Last successful fetch from the remote"),
    ).toBeInTheDocument();
  });

  it("tooltips the implicit fetch failure without breaking the status view", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          branch: "main",
          remote: "origin",
          ahead: 0,
          behind: 0,
          hasRemoteBranch: true,
          lastFetchedAt: null,
          lastFetchError: "network unreachable",
        },
      }),
    } as Response);

    render(<GitSyncPage />);

    await waitFor(() => {
      expect(screen.getByText("Never synced")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Could not fetch from remote: network unreachable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ahead:")).toBeInTheDocument();
  });

  it("omits the freshness label when the API does not report a fetch", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          branch: "main",
          remote: "origin",
          ahead: 0,
          behind: 0,
          hasRemoteBranch: true,
        },
      }),
    } as Response);

    render(<GitSyncPage />);

    await waitFor(() => {
      expect(screen.getByText("Ahead:")).toBeInTheDocument();
    });
    expect(screen.queryByText(/^Synced /)).toBeNull();
    expect(screen.queryByText("Never synced")).toBeNull();
  });

  it("shows manual conflict diff view when pull returns 409 conflicts", async () => {
    const user = userEvent.setup();
    const statusPayload = {
      ok: true,
      json: async () => ({
        data: {
          branch: "main",
          remote: "origin",
          ahead: 0,
          behind: 0,
          hasRemoteBranch: true,
        },
      }),
    } as Response;

    vi.spyOn(global, "fetch")
      // 1st call: initial status fetch (branch is "")
      .mockResolvedValueOnce(statusPayload)
      // 2nd call: status re-fetch triggered when branch changes "" -> "main"
      .mockResolvedValueOnce(statusPayload)
      // 3rd call: the actual pull POST returning 409
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: "Pull resulted in merge conflicts.",
          code: "merge_conflicts",
          conflicted: true,
          conflictDiffs: [
            { filePath: "src/a.ts", diff: "@@ -1 +1 @@" },
          ],
        }),
      } as Response);

    render(<GitSyncPage />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Pull" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Pull" }));

    await waitFor(() => {
      expect(screen.getByText("Manual Conflict Review")).toBeInTheDocument();
      expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    });
  });
});
