import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QuickCapture } from "@/components/kanban/QuickCapture";

describe("QuickCapture", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function typeAndSubmit(value: string) {
    const input = screen.getByTestId("quick-capture-input");
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
    return input as HTMLInputElement;
  }

  it("POSTs the epics route with a backlog draft feature and clears on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "epic-new" } }),
    });
    global.fetch = mockFetch;
    const onCreated = vi.fn();

    render(<QuickCapture projectId="proj-1" onCreated={onCreated} />);

    const input = typeAndSubmit("  Ship dark mode toggle  ");

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/projects/proj-1/epics",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Ship dark mode toggle",
            status: "backlog",
            type: "feature",
          }),
        })
      );
    });

    await waitFor(() => {
      expect(input.value).toBe("");
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Enter with an empty or whitespace-only title", () => {
    const mockFetch = vi.fn();
    global.fetch = mockFetch;

    render(<QuickCapture projectId="proj-1" />);

    const input = screen.getByTestId("quick-capture-input");
    fireEvent.keyDown(input, { key: "Enter" });
    typeAndSubmit("   ");

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("keeps the typed title and reports the error when the POST fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Project not found" }),
    });
    const onCreated = vi.fn();
    const onError = vi.fn();

    render(
      <QuickCapture projectId="proj-1" onCreated={onCreated} onError={onError} />
    );

    const input = typeAndSubmit("Persist filters");

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Project not found");
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(input.value).toBe("Persist filters");
  });

  it("reports a generic error when the network request throws", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline"));
    const onError = vi.fn();

    render(<QuickCapture projectId="proj-1" onError={onError} />);

    typeAndSubmit("Offline idea");

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith("Failed to capture idea");
    });
  });
});
