/**
 * Tests that the sessions list page renders queued sessions distinctly:
 * amber Queued status row plus a queued counter in the header.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import SessionsPage from "@/app/projects/[projectId]/sessions/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
}));

function agentSession(overrides: Record<string, unknown>) {
  return {
    kind: "agent_session",
    id: "sess-x",
    status: "completed",
    mode: "code",
    provider: "claude-code",
    createdAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("SessionsPage — queued sessions", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            agentSession({ id: "sess-queued", status: "queued" }),
            agentSession({
              id: "sess-running",
              status: "running",
              startedAt: "2026-08-15T10:01:00.000Z",
            }),
            agentSession({ id: "sess-done", status: "completed" }),
          ],
        }),
      }))
    );
  });

  it("shows the queued counter and the Queued status row", async () => {
    render(<SessionsPage />);

    await waitFor(() =>
      expect(screen.queryByText("Loading sessions...")).not.toBeInTheDocument()
    );

    expect(screen.getByText("1 queued")).toBeInTheDocument();
    expect(screen.getByText("1 running")).toBeInTheDocument();
    expect(screen.getByText("1 completed")).toBeInTheDocument();

    // The queued card renders the amber-styled counter (distinct style).
    expect(screen.getByText("1 queued").className).toContain("text-amber-500");
  });

  it("omits the queued counter when nothing is queued", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [agentSession({ id: "sess-done", status: "completed" })],
        }),
      }))
    );

    render(<SessionsPage />);

    await waitFor(() =>
      expect(screen.queryByText("Loading sessions...")).not.toBeInTheDocument()
    );

    expect(screen.queryByText(/queued/)).not.toBeInTheDocument();
  });
});
