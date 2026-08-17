import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const nav = vi.hoisted(() => ({
  pathname: "/projects/proj-1",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "proj-1" }),
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push }),
}));

vi.mock("@/components/github/GitHubConnectBanner", () => ({
  GitHubConnectBanner: () => <div data-testid="github-connect-banner" />,
}));

// The two ambient bands are covered by their own tests; stub them here so the
// layout test stays about the chrome and not about their pollers.
vi.mock("@/components/layout/CockpitBar", () => ({
  CockpitBar: ({ projectId }: { projectId: string }) => (
    <div data-testid="cockpit-bar" data-project={projectId} />
  ),
}));
vi.mock("@/components/layout/RepoStatusBar", () => ({
  RepoStatusBar: ({ ownerRepo }: { ownerRepo: string | null }) => (
    <div data-testid="repo-status-bar" data-owner-repo={ownerRepo ?? ""} />
  ),
}));

import ProjectLayout from "@/app/projects/[projectId]/layout";

describe("project layout chrome", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    nav.pathname = "/projects/proj-1";
    nav.push = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: {
            name: "Project One",
            gitRepoPath: "/tmp/repo",
            githubOwnerRepo: "owner/repo",
          },
        }),
    });
  });

  async function renderLayout() {
    render(
      <ProjectLayout>
        <div data-testid="project-content">content</div>
      </ProjectLayout>,
    );
    await waitFor(() => {
      expect(screen.getByText("Project One")).toBeInTheDocument();
    });
  }

  it("renders the project name, children and the connect banner", async () => {
    await renderLayout();

    expect(screen.getByTestId("project-content")).toBeInTheDocument();
    expect(screen.getByTestId("github-connect-banner")).toBeInTheDocument();
  });

  it("routes the header Chat button to the board panel instead of opening a legacy panel", async () => {
    const user = userEvent.setup();
    await renderLayout();

    await user.click(screen.getByTestId("header-chat-button"));

    expect(nav.push).toHaveBeenCalledWith("/projects/proj-1?panel=chat");
  });

  it("does not fetch conversation count for removed legacy chat pathways", async () => {
    const user = userEvent.setup();
    await renderLayout();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/projects/proj-1");
    });

    await user.click(screen.getByTestId("header-chat-button"));

    expect(global.fetch).not.toHaveBeenCalledWith(
      "/api/projects/proj-1/conversations",
    );
  });

  it("keeps the secondary pages reachable from the More menu", async () => {
    const user = userEvent.setup();
    await renderLayout();

    expect(screen.queryByRole("link", { name: /QA/i })).not.toBeInTheDocument();

    await user.click(screen.getByTestId("project-nav-more"));

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: /QA/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("menuitem", { name: /QA/i })).toHaveAttribute(
      "href",
      "/projects/proj-1/qa",
    );
    expect(screen.getByRole("menuitem", { name: /Git Sync/i })).toHaveAttribute(
      "href",
      "/projects/proj-1/git-sync",
    );
  });

  it("exposes the three primary tabs as links", async () => {
    await renderLayout();

    expect(screen.getByRole("link", { name: "Board" })).toHaveAttribute(
      "href",
      "/projects/proj-1",
    );
    expect(screen.getByRole("link", { name: "Spec" })).toHaveAttribute(
      "href",
      "/projects/proj-1/spec",
    );
    expect(screen.getByRole("link", { name: "Sessions" })).toHaveAttribute(
      "href",
      "/projects/proj-1/sessions",
    );
  });

  it("starts a night run through the board URL param", async () => {
    const user = userEvent.setup();
    await renderLayout();

    await user.click(screen.getByTestId("night-run-button"));

    expect(nav.push).toHaveBeenCalledWith("/projects/proj-1?night=start");
  });

  it("opens the new-epic and new-bug panels from the New menu", async () => {
    const user = userEvent.setup();
    await renderLayout();

    await user.click(screen.getByTestId("header-new-button"));
    await waitFor(() => {
      expect(screen.getByTestId("header-new-epic")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("header-new-epic"));
    expect(nav.push).toHaveBeenCalledWith("/projects/proj-1?panel=new-epic");

    await user.click(screen.getByTestId("header-new-button"));
    await waitFor(() => {
      expect(screen.getByTestId("header-new-bug")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("header-new-bug"));
    expect(nav.push).toHaveBeenCalledWith("/projects/proj-1?panel=new-bug");
  });

  it("mounts the ambient bands on the board route only", async () => {
    await renderLayout();

    expect(screen.getByTestId("cockpit-bar")).toBeInTheDocument();
    expect(screen.getByTestId("repo-status-bar")).toHaveAttribute(
      "data-owner-repo",
      "owner/repo",
    );
  });

  it("hides the ambient bands on secondary pages", async () => {
    nav.pathname = "/projects/proj-1/sessions";
    await renderLayout();

    expect(screen.queryByTestId("cockpit-bar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("repo-status-bar")).not.toBeInTheDocument();
  });

  it("keeps the arji.json sync action available", async () => {
    await renderLayout();

    const sync = screen.getByRole("button", { name: "Sync from arji.json" });
    expect(sync).toBeInTheDocument();
  });
});
