import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AgentMonitor } from "@/components/monitor/AgentMonitor";

describe("AgentMonitor", () => {
  it("renders elapsed time and activity label for running activities", async () => {
    const startedAt = new Date(Date.now() - 65_000).toISOString();

    render(
      <AgentMonitor
        projectId="proj-1"
        activities={[
          {
            id: "sess-1",
            epicId: "epic-1",
            userStoryId: null,
            type: "build",
            label: "Building: Implement API",
            status: "running",
            mode: "code",
            provider: "codex",
            startedAt,
            source: "db",
            cancellable: true,
          },
        ]}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByText((text) => /^1m \d+s$/.test(text))
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Building: Implement API")).toBeInTheDocument();
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });

  it("renders queued activities distinctly: after running ones, with a queued marker instead of a timer", () => {
    render(
      <AgentMonitor
        projectId="proj-1"
        activities={[
          {
            id: "sess-queued",
            epicId: "epic-2",
            userStoryId: null,
            type: "build",
            label: "Building: Waiting Epic",
            status: "queued",
            mode: "code",
            provider: "claude-code",
            startedAt: new Date().toISOString(),
            source: "db",
            cancellable: true,
          },
          {
            id: "sess-running",
            epicId: "epic-1",
            userStoryId: null,
            type: "build",
            label: "Building: Active Epic",
            status: "running",
            mode: "code",
            provider: "claude-code",
            startedAt: new Date().toISOString(),
            source: "db",
            cancellable: true,
          },
        ]}
      />
    );

    // Header counts running and queued separately.
    expect(screen.getByText("1 active agent · 1 queued")).toBeInTheDocument();

    // Queued row shows the marker text instead of an elapsed timer.
    expect(screen.getByText("queued")).toBeInTheDocument();

    // Running rows come first even when the queued one arrived first.
    const runningRow = screen.getByTestId("agent-monitor-activity-sess-running");
    const queuedRow = screen.getByTestId("agent-monitor-activity-sess-queued");
    expect(
      runningRow.compareDocumentPosition(queuedRow) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(queuedRow.className).toContain("opacity-70");
    expect(runningRow.className).not.toContain("opacity-70");

    // Queued sessions stay cancellable.
    expect(queuedRow.querySelector("button[title='Cancel']")).toBeTruthy();
  });

  it("keeps the plain active-agents header when nothing is queued", () => {
    render(
      <AgentMonitor
        projectId="proj-1"
        activities={[
          {
            id: "sess-1",
            epicId: "epic-1",
            userStoryId: null,
            type: "build",
            label: "Building: A",
            status: "running",
            mode: "code",
            provider: "claude-code",
            startedAt: new Date().toISOString(),
            source: "db",
            cancellable: true,
          },
        ]}
      />
    );

    expect(screen.getByText("1 active agent")).toBeInTheDocument();
    expect(screen.queryByText(/queued/)).not.toBeInTheDocument();
  });

  it("renders stalled running activities in amber with a no-output tooltip and a Stop session action", () => {
    const lastActivityAt = new Date(Date.now() - 7 * 60_000).toISOString();

    render(
      <AgentMonitor
        projectId="proj-1"
        activities={[
          {
            id: "sess-stalled",
            epicId: "epic-1",
            userStoryId: null,
            type: "build",
            label: "Building: Stuck Epic",
            status: "running",
            mode: "code",
            provider: "claude-code",
            startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
            source: "db",
            cancellable: true,
            lastActivityAt,
            stale: true,
          },
          {
            id: "sess-healthy",
            epicId: "epic-2",
            userStoryId: null,
            type: "build",
            label: "Building: Healthy Epic",
            status: "running",
            mode: "code",
            provider: "claude-code",
            startedAt: new Date().toISOString(),
            source: "db",
            cancellable: true,
            lastActivityAt: new Date().toISOString(),
            stale: false,
          },
        ]}
      />
    );

    // Amber stalled marker with the "No output for Xm" tooltip.
    const marker = screen.getByTestId("agent-monitor-stalled-sess-stalled");
    expect(marker).toHaveTextContent("stalled");
    expect(marker.className).toContain("text-amber-500");
    expect(marker.getAttribute("title")).toBe("No output for 7m");

    // The stalled row's cancel affordance reads as "Stop session".
    const stalledRow = screen.getByTestId("agent-monitor-activity-sess-stalled");
    expect(stalledRow.querySelector("button[title='Stop session']")).toBeTruthy();

    // Healthy rows keep the green state and plain Cancel affordance.
    expect(
      screen.queryByTestId("agent-monitor-stalled-sess-healthy")
    ).not.toBeInTheDocument();
    const healthyRow = screen.getByTestId("agent-monitor-activity-sess-healthy");
    expect(healthyRow.querySelector("button[title='Cancel']")).toBeTruthy();
    expect(healthyRow.querySelector("svg.text-green-500")).toBeTruthy();
    expect(stalledRow.querySelector("svg.text-amber-500")).toBeTruthy();
  });

  it("never shows the stalled marker on queued rows", () => {
    render(
      <AgentMonitor
        projectId="proj-1"
        activities={[
          {
            id: "sess-q",
            epicId: "epic-1",
            userStoryId: null,
            type: "build",
            label: "Building: Q",
            status: "queued",
            mode: "code",
            provider: "claude-code",
            startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
            source: "db",
            cancellable: true,
            lastActivityAt: null,
            // Defensive: even if the API ever mislabeled a queued row.
            stale: true,
          },
        ]}
      />
    );

    expect(
      screen.queryByTestId("agent-monitor-stalled-sess-q")
    ).not.toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
  });

  it("highlights only the linked activity row", () => {
    render(
      <AgentMonitor
        projectId="proj-1"
        highlightedActivityId="sess-2"
        activities={[
          {
            id: "sess-1",
            epicId: "epic-1",
            userStoryId: null,
            type: "build",
            label: "Building: A",
            status: "running",
            mode: "code",
            provider: "codex",
            startedAt: new Date().toISOString(),
            source: "db",
            cancellable: true,
          },
          {
            id: "sess-2",
            epicId: "epic-2",
            userStoryId: null,
            type: "review",
            label: "Reviewing: B",
            status: "running",
            mode: "plan",
            provider: "claude-code",
            startedAt: new Date().toISOString(),
            source: "db",
            cancellable: true,
          },
        ]}
      />
    );

    expect(screen.getByTestId("agent-monitor-activity-sess-2").className).toContain(
      "bg-primary/10"
    );
    expect(screen.getByTestId("agent-monitor-activity-sess-1").className).not.toContain(
      "bg-primary/10"
    );
  });
});
