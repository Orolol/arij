import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitHubIssuesPage from "@/app/projects/[projectId]/github-issues/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
}));

describe("GitHubIssuesPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders triage list and imported indicator", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "ghi_1",
            issueNumber: 11,
            title: "Feature issue",
            labels: ["feature"],
            milestone: "v1",
            githubUrl: "https://github.com/o/r/issues/11",
            createdAtGitHub: "2026-02-10T00:00:00Z",
            importedEpicId: "ep_1",
          },
        ],
      }),
    } as Response);

    render(<GitHubIssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("GitHub Issue Triage")).toBeInTheDocument();
      expect(screen.getByText("Imported")).toBeInTheDocument();
    });
  });

  it("imports selected issues", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "ghi_1",
              issueNumber: 42,
              title: "Bug issue",
              labels: ["bug"],
              milestone: null,
              githubUrl: "https://github.com/o/r/issues/42",
              createdAtGitHub: "2026-02-10T00:00:00Z",
              importedEpicId: null,
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ data: { imported: [{ issueNumber: 42, epicId: "ep_9", type: "bug" }] } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [] }),
      } as Response);

    render(<GitHubIssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("#42 Bug issue")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /Import Selected/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/proj-1/github/issues/import",
        expect.objectContaining({ method: "POST" })
      );
    });
  });
});
