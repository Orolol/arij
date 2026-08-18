/**
 * A night run registers in the same wave registry as a plain DAG batch, so
 * the AgentMonitor chip keeps working — it only switches to the moon wording
 * when the batch id carries the night prefix, and adds the run-level stop
 * control next to it (night runs only).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentMonitor } from "@/components/monitor/AgentMonitor";
import type { UnifiedActivity } from "@/hooks/useAgentPolling";
import { NIGHT_RUN_ID_PREFIX } from "@/lib/night/constants";

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

function mockWaves(batchId: string) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        data: [{ batchId, currentWave: 2, totalWaves: 4 }],
      }),
  });
}

describe("AgentMonitor — night run wave chip", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("labels a night run's waves as 'Night wave'", async () => {
    const batchId = `${NIGHT_RUN_ID_PREFIX}abc123`;
    mockWaves(batchId);

    render(
      <AgentMonitor projectId="proj-1" activities={[runningActivity("s1")]} />
    );

    await waitFor(() =>
      expect(
        screen.getByTestId(`agent-monitor-wave-${batchId}`)
      ).toBeInTheDocument()
    );
    const chip = screen.getByTestId(`agent-monitor-wave-${batchId}`);
    expect(chip.textContent).toContain("Night wave 2/4");
    expect(chip).toHaveAttribute("data-night", "true");
  });

  it("leaves a plain DAG batch chip untouched", async () => {
    mockWaves("batch-9");

    render(
      <AgentMonitor projectId="proj-1" activities={[runningActivity("s1")]} />
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("agent-monitor-wave-batch-9")
      ).toBeInTheDocument()
    );
    const chip = screen.getByTestId("agent-monitor-wave-batch-9");
    expect(chip.textContent).toContain("Wave 2/4");
    expect(chip.textContent).not.toContain("Night");
    expect(chip).not.toHaveAttribute("data-night");
    // A plain DAG batch has no run-level stop control.
    expect(
      screen.queryByTestId("agent-monitor-night-stop")
    ).not.toBeInTheDocument();
  });

  it("stops the night run from the chip area and latches the button", async () => {
    const batchId = `${NIGHT_RUN_ID_PREFIX}stopme`;
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        calls.push({ url, method: init?.method });
        return {
          ok: true,
          status: 200,
          json: async () =>
            init?.method === "POST"
              ? { data: { stopping: true } }
              : { data: [{ batchId, currentWave: 1, totalWaves: 3 }] },
        };
      })
    );

    render(
      <AgentMonitor projectId="proj-1" activities={[runningActivity("s1")]} />
    );

    const stop = await screen.findByTestId("agent-monitor-night-stop");
    expect(stop).toHaveTextContent("Stop night run");
    await userEvent.click(stop);

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "POST" &&
            call.url ===
              `/api/projects/proj-1/build/night-runs/${batchId}/stop`
        )
      ).toBe(true)
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("agent-monitor-night-stop")
      ).toHaveTextContent("Stopping…")
    );
    expect(screen.getByTestId("agent-monitor-night-stop")).toBeDisabled();
  });

  it("keeps the expand/collapse toggle working next to the stop control", async () => {
    const batchId = `${NIGHT_RUN_ID_PREFIX}toggle`;
    mockWaves(batchId);

    render(
      <AgentMonitor projectId="proj-1" activities={[runningActivity("s1")]} />
    );

    // The list starts expanded; the activity row is visible.
    expect(
      screen.getByTestId("agent-monitor-activity-s1")
    ).toBeInTheDocument();

    await userEvent.click(screen.getByText("1 active agent"));
    expect(
      screen.queryByTestId("agent-monitor-activity-s1")
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText("Expand agent list"));
    expect(
      screen.getByTestId("agent-monitor-activity-s1")
    ).toBeInTheDocument();
  });
});
