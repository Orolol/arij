import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitHubIssuesPage from "@/app/projects/[projectId]/github-issues/page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
}));

type IssueRow = {
  id: string;
  issueNumber: number;
  title: string;
  labels: string[];
  milestone: string | null;
  githubUrl: string;
  createdAtGitHub: string | null;
  importedEpicId: string | null;
};

/**
 * The page mounts several independent fetches (triage list, label mapping,
 * GitHub config for the repo context line), so route on the URL rather than on
 * call order.
 */
function mockFetchByUrl(options: {
  issues: IssueRow[];
  onImport?: () => void;
}) {
  return vi.spyOn(global, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit
  ) => {
    const url = String(input);

    if (url.includes("/github/issues/triage")) {
      return { ok: true, json: async () => ({ data: options.issues }) } as Response;
    }
    if (url.includes("/github/issues/import")) {
      options.onImport?.();
      return {
        ok: true,
        status: 201,
        json: async () => ({
          data: { imported: [{ issueNumber: 42, epicId: "ep_9", type: "bug" }] },
        }),
      } as Response;
    }
    if (url.includes("/github/label-mapping")) {
      return {
        ok: true,
        json: async () => ({ data: { featureLabels: ["feature"], bugLabels: ["bug"] } }),
      } as Response;
    }
    if (url === "/api/settings") {
      return { ok: true, json: async () => ({ data: { github_pat: "tok" } }) } as Response;
    }
    if (url === "/api/projects/proj-1") {
      return {
        ok: true,
        json: async () => ({ data: { githubOwnerRepo: "Orolol/arij" } }),
      } as Response;
    }

    return { ok: true, json: async () => ({ data: [] }) } as Response;
  }) as typeof fetch);
}

describe("GitHubIssuesPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders triage list and imported indicator", async () => {
    mockFetchByUrl({
      issues: [
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
    });

    render(<GitHubIssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("GitHub Issue Triage")).toBeInTheDocument();
      expect(screen.getByText("imported")).toBeInTheDocument();
    });

    expect(screen.getByText("#11")).toBeInTheDocument();
    expect(screen.getByText("Feature issue")).toBeInTheDocument();
    expect(screen.getByText("feature")).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("imports selected issues", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetchByUrl({
      issues: [
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
    });

    render(<GitHubIssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("Bug issue")).toBeInTheDocument();
    });
    expect(screen.getByText("to import")).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Select issue #42" }));
    await user.click(screen.getByRole("button", { name: /Import Selected/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/proj-1/github/issues/import",
        expect.objectContaining({ method: "POST" })
      );
    });
  });
});
