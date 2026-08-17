/**
 * Tests for the AgentMonitor's compact "Wave x/y" indicator, fed by polling
 * GET /api/projects/[projectId]/build/waves.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AgentMonitor } from "@/components/monitor/AgentMonitor";
import type { UnifiedActivity } from "@/hooks/useAgentPolling";

function runningActivity(id: string): UnifiedActivity {
  return {
    id,
    epicId: "epic-1",
    userStoryId: null,
    type: "build",
    label: `Building: ${id}`,
    status: "running",
    mode: "code",
    provider: "claude-code",
    startedAt: new Date().toISOString(),
    source: "db",
    cancellable: true,
  };
}

describe("AgentMonitor wave indicator", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows 'Wave 2/4' while a DAG batch is running", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: [{ batchId: "batch-1", currentWave: 2, totalWaves: 4 }],
        }),
    });

    render(
      <AgentMonitor projectId="proj-1" activities={[runningActivity("s1")]} />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("agent-monitor-wave-batch-1")
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("agent-monitor-wave-batch-1").textContent).toContain(
      "Wave 2/4"
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects/proj-1/build/waves"
    );
  });

  it("renders wave 1 while the first wave is still dispatching (currentWave 0)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: [{ batchId: "batch-2", currentWave: 0, totalWaves: 3 }],
        }),
    });

    render(
      <AgentMonitor projectId="proj-1" activities={[runningActivity("s1")]} />
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("agent-monitor-wave-batch-2").textContent
      ).toContain("Wave 1/3");
    });
  });

  it("shows no indicator when no DAG batch is active", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ data: [] }),
    });

    render(
      <AgentMonitor projectId="proj-1" activities={[runningActivity("s1")]} />
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    expect(screen.queryByText(/^Wave \d+\/\d+$/)).not.toBeInTheDocument();
  });

  it("survives a failing waves endpoint (indicator stays hidden)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline"));

    render(
      <AgentMonitor projectId="proj-1" activities={[runningActivity("s1")]} />
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    expect(screen.getByText("1 active agent")).toBeInTheDocument();
    expect(screen.queryByText(/Wave/)).not.toBeInTheDocument();
  });
});
