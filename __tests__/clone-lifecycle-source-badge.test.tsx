import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectSourceBadge } from "@/components/layout/ProjectSourceBadge";

/**
 * Story: "As a user, I want to see where a project lives and where it came
 * from" — the header strip that answers both questions.
 */

const CLONE_PATH = "/home/me/arij/projects/owner-repo";
const USER_PATH = "/home/me/code/my-own-repo";

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom exposes navigator.clipboard as a getter-only property.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
});

describe("ProjectSourceBadge", () => {
  it("shows the absolute repository path", () => {
    render(
      <ProjectSourceBadge
        gitRepoPath={CLONE_PATH}
        cloneSource="github"
        gitRemoteUrl="https://github.com/owner/repo.git"
      />
    );

    expect(screen.getByTestId("project-source-path")).toHaveTextContent(CLONE_PATH);
  });

  it("marks an Arij-managed clone and links to its source", () => {
    render(
      <ProjectSourceBadge
        gitRepoPath={CLONE_PATH}
        cloneSource="github"
        gitRemoteUrl="https://github.com/owner/repo.git"
      />
    );

    expect(screen.getByTestId("project-source-clone-badge")).toHaveTextContent(
      "Arij-managed clone"
    );

    const link = screen.getByTestId("project-source-remote-link");
    // `.git` is stripped so the href opens the browsable repository page.
    expect(link).toHaveAttribute("href", "https://github.com/owner/repo");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveTextContent("owner/repo");
  });

  it("renders a user-supplied project with no badge and no link", () => {
    render(
      <ProjectSourceBadge
        gitRepoPath={USER_PATH}
        cloneSource={null}
        gitRemoteUrl={null}
      />
    );

    expect(screen.getByTestId("project-source-path")).toHaveTextContent(USER_PATH);
    expect(screen.queryByTestId("project-source-clone-badge")).toBeNull();
    expect(screen.queryByTestId("project-source-remote-link")).toBeNull();
  });

  it("shows no badge for a user-supplied project that happens to have a remote", () => {
    render(
      <ProjectSourceBadge
        gitRepoPath={USER_PATH}
        cloneSource={null}
        gitRemoteUrl="https://github.com/owner/repo.git"
      />
    );

    expect(screen.queryByTestId("project-source-clone-badge")).toBeNull();
    expect(screen.queryByTestId("project-source-remote-link")).toBeNull();
  });

  it("copies the path to the clipboard in one click", async () => {
    render(
      <ProjectSourceBadge
        gitRepoPath={CLONE_PATH}
        cloneSource="github"
        gitRemoteUrl="https://github.com/owner/repo.git"
      />
    );

    fireEvent.click(screen.getByTestId("project-source-copy-path"));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(CLONE_PATH);
    await waitFor(() =>
      expect(screen.getByTestId("project-source-copy-path")).toHaveAttribute(
        "aria-label",
        "Repository path copied"
      )
    );
  });

  it("stays usable when the clipboard is denied", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(
      <ProjectSourceBadge
        gitRepoPath={CLONE_PATH}
        cloneSource="github"
        gitRemoteUrl={null}
      />
    );

    fireEvent.click(screen.getByTestId("project-source-copy-path"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("project-source-copy-path")).toHaveAttribute(
      "aria-label",
      "Copy repository path"
    );
    expect(screen.getByTestId("project-source-path")).toHaveTextContent(CLONE_PATH);
  });

  it("renders nothing when the project has no repository path", () => {
    const { container } = render(
      <ProjectSourceBadge
        gitRepoPath={null}
        cloneSource="github"
        gitRemoteUrl="https://github.com/owner/repo.git"
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("omits the link for a clone whose remote is not a browsable URL", () => {
    render(
      <ProjectSourceBadge
        gitRepoPath={CLONE_PATH}
        cloneSource="github"
        gitRemoteUrl="git@github.com:owner/repo.git"
      />
    );

    expect(screen.getByTestId("project-source-clone-badge")).toBeInTheDocument();
    expect(screen.queryByTestId("project-source-remote-link")).toBeNull();
  });
});
