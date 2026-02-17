import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitSyncPage from "@/app/projects/[projectId]/git-sync/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
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

  it("shows manual conflict diff view when pull returns 409 conflicts", async () => {
    const user = userEvent.setup();
    vi.spyOn(global, "fetch")
      .mockResolvedValueOnce({
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
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: "Pull resulted in merge conflicts.",
          data: {
            conflicted: true,
            conflictDiffs: [
              { filePath: "src/a.ts", diff: "@@ -1 +1 @@" },
            ],
          },
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
