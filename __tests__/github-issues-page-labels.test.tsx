import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitHubIssuesPage from "@/app/projects/[projectId]/github-issues/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
}));

const saveRequest = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.restoreAllMocks();
  saveRequest.mockReset();
  vi.spyOn(global, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const url = String(input);
    if (url.includes("/github/label-mapping")) {
      if (init?.method === "PUT") return saveRequest(input, init);
      return {
        ok: true,
        json: async () => ({
          data: { featureLabels: ["feature"], bugLabels: ["bug"] },
        }),
      } as Response;
    }
    if (url === "/api/github/config") {
      return {
        ok: true,
        json: async () => ({ data: { tokenSet: true } }),
      } as Response;
    }
    if (url === "/api/projects") {
      return {
        ok: true,
        json: async () => ({ data: { githubOwnerRepo: "Orolol/arij" } }),
      } as Response;
    }
    return { ok: true, json: async () => ({ data: [] }) } as Response;
  }) as typeof fetch);
});

describe("GitHub issues label mapping accessibility", () => {
  it("names both label-mapping fields through their visible labels", async () => {
    render(<GitHubIssuesPage />);

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("feature, enhancement, epic")
      ).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Feature labels (comma-separated)")).toBe(
      screen.getByPlaceholderText("feature, enhancement, epic")
    );
    expect(screen.getByLabelText("Bug labels (comma-separated)")).toBe(
      screen.getByPlaceholderText("bug, defect, error")
    );
  });

  it("exposes the mapping explanation as the fields' description", async () => {
    render(<GitHubIssuesPage />);

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("feature, enhancement, epic")
      ).toBeInTheDocument();
    });

    const description =
      "Configure which GitHub labels map to Feature (Epic) or Bug ticket types.";
    expect(
      screen.getByLabelText("Feature labels (comma-separated)")
    ).toHaveAccessibleDescription(description);
    expect(
      screen.getByLabelText("Bug labels (comma-separated)")
    ).toHaveAccessibleDescription(description);
  });
});

describe("GitHub issues label mapping feedback", () => {
  it.each([
    { outcome: "success", status: 200, body: { data: { featureLabels: ["feature", "enhancement", "epic"], bugLabels: ["bug", "defect"] } }, message: "Label mapping saved" },
    { outcome: "validation failure", status: 400, body: { error: "Invalid label mapping" }, message: "Invalid label mapping" },
    { outcome: "server failure", status: 500, body: { error: "Database disk full" }, message: "Database disk full" },
    { outcome: "HTTP failure without an error message", status: 500, body: {}, message: "Failed to save label mapping" },
    { outcome: "non-JSON HTTP failure", status: 502, body: null, message: "Failed to save label mapping" },
    { outcome: "network rejection", status: 0, body: null, message: "Failed to save label mapping" },
  ])("reports $outcome and releases the saving state", async ({ status, body, message }) => {
    let resolveSave!: (response: Response) => void;
    let rejectSave!: (error: Error) => void;
    saveRequest.mockReturnValue(new Promise<Response>((resolve, reject) => {
      resolveSave = resolve;
      rejectSave = reject;
    }));
    const user = userEvent.setup();
    render(<GitHubIssuesPage />);
    const featureInput = screen.getByLabelText("Feature labels (comma-separated)");
    await waitFor(() => expect(featureInput).toHaveValue("feature"));
    await user.clear(featureInput);
    await user.type(featureInput, " feature, enhancement, , epic ");
    const bugInput = screen.getByLabelText("Bug labels (comma-separated)");
    await user.clear(bugInput);
    await user.type(bugInput, " bug, defect, ");

    const saveButton = screen.getByRole("button", { name: "Save Mapping" });
    await user.click(saveButton);
    expect(saveButton).toBeDisabled();
    expect(saveRequest).toHaveBeenCalledTimes(1);
    expect(saveRequest).toHaveBeenCalledWith(
      "/api/projects/proj-1/github/label-mapping",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureLabels: ["feature", "enhancement", "epic"], bugLabels: ["bug", "defect"] }),
      }
    );
    expect(screen.queryByText(message)).not.toBeInTheDocument();

    await act(async () => {
      if (status === 0) rejectSave(new TypeError("Failed to fetch"));
      else resolveSave(new Response(body === null ? "Bad gateway" : JSON.stringify(body), { status }));
    });

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(saveButton).toBeEnabled();
    expect(featureInput).toHaveValue(" feature, enhancement, , epic ");
    expect(bugInput).toHaveValue(" bug, defect, ");
    if (status !== 200) expect(screen.queryByText("Label mapping saved")).not.toBeInTheDocument();
  });
});
