/**
 * The import page's GitHub source: the switch between a local folder and a
 * repository URL, the inline validation, and the clone → analyze → preview
 * chain the page drives across two endpoints.
 *
 * The Playwright pass in e2e/project-import.spec.ts covers the same flow in a
 * real browser; these run in jsdom, where the request bodies the page sends
 * are cheap to assert directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ImportProjectPage from "@/app/projects/import/page";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const CLONE_DATA = {
  path: "/workspace/projects/octocat-hello-world",
  ownerRepo: "octocat/hello-world",
  remoteUrl: "https://github.com/octocat/hello-world.git",
  defaultBranch: "main",
  reused: false,
};

const PREVIEW = {
  project: { name: "hello-world", description: "Sample", stack: "TypeScript" },
  epics: [
    {
      title: "Toolchain",
      status: "backlog",
      user_stories: [
        { title: "As a dev, I want CI", acceptance_criteria: "- [ ] green", status: "todo" },
      ],
    },
  ],
};

interface FetchCall {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

let calls: FetchCall[];

/**
 * @param overrides per-endpoint responses; anything unset succeeds with the
 *                  happy-path payload.
 */
function mockFetch(
  overrides: Record<string, { ok?: boolean; json: unknown }> = {}
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init?.method ?? "GET", body });

    for (const [pattern, response] of Object.entries(overrides)) {
      if (url.includes(pattern)) {
        return {
          ok: response.ok ?? true,
          json: async () => response.json,
        } as Response;
      }
    }

    if (url === "/api/settings") {
      return {
        ok: true,
        json: async () => ({
          data: {},
          defaults: { projects_root: "/workspace/projects" },
        }),
      } as Response;
    }
    if (url.includes("/api/projects/clone")) {
      return { ok: true, json: async () => ({ data: CLONE_DATA }) } as Response;
    }
    if (url.includes("/api/projects/import")) {
      return {
        ok: true,
        json: async () => ({ data: { preview: PREVIEW, fromExistingFile: false } }),
      } as Response;
    }
    // Project creation and the follow-up PATCH/epics/sync calls.
    return { ok: true, json: async () => ({ data: { id: "proj-1" } }) } as Response;
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Renders the page and waits for the settings effect to settle — otherwise the
 * projects-root fetch resolves after the test body and React logs an
 * act() warning for a state update nobody is waiting on.
 */
async function renderPage() {
  const rendered = render(<ImportProjectPage />);
  await waitFor(() =>
    expect(calls.some((c) => c.url === "/api/settings")).toBe(true)
  );
  return rendered;
}

function chooseGitHub() {
  fireEvent.click(screen.getByRole("radio", { name: /GitHub URL/ }));
}

function urlField() {
  return screen.getByLabelText("GitHub repository URL");
}

function cloneButton() {
  return screen.getByRole("button", { name: /Clone & Analyze/ });
}

beforeEach(() => {
  calls = [];
  push.mockClear();
  mockFetch();
});

describe("import source picker", () => {
  it("offers both sources and defaults to the local folder", async () => {
    await renderPage();

    expect(screen.getByRole("radio", { name: /Local folder/ })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByRole("radio", { name: /GitHub URL/ })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(
      screen.getByPlaceholderText("/path/to/your/project")
    ).toBeInTheDocument();
  });

  it("swaps the folder field for the URL field and back", async () => {
    await renderPage();

    chooseGitHub();
    expect(urlField()).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("/path/to/your/project")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Local folder/ }));
    expect(
      screen.getByPlaceholderText("/path/to/your/project")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("GitHub repository URL")).not.toBeInTheDocument();
  });
});

describe("GitHub URL validation", () => {
  it("disables the submit button until the input parses", async () => {
    await renderPage();
    chooseGitHub();

    expect(cloneButton()).toBeDisabled();

    fireEvent.change(urlField(), { target: { value: "https://gitlab.com/o/r" } });
    expect(cloneButton()).toBeDisabled();

    fireEvent.change(urlField(), {
      target: { value: "https://github.com/octocat/hello-world" },
    });
    expect(cloneButton()).toBeEnabled();
  });

  it("shows inline feedback only once something has been typed", async () => {
    await renderPage();
    chooseGitHub();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.change(urlField(), { target: { value: "not a repo" } });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Not a GitHub repository"
    );

    fireEvent.change(urlField(), { target: { value: "octocat/hello-world" } });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["octocat/.."],
    ["../../etc/passwd"],
    ["https://github.com/octocat/%2e%2e"],
    ["-octocat/repo"],
  ])("refuses the traversal payload %s without calling the server", async (value) => {
    await renderPage();
    chooseGitHub();

    fireEvent.change(urlField(), { target: { value } });

    expect(cloneButton()).toBeDisabled();
    expect(calls.filter((c) => c.url.includes("/clone"))).toHaveLength(0);
  });

  it("names the destination the clone will land in", async () => {
    await renderPage();

    chooseGitHub();
    fireEvent.change(urlField(), { target: { value: "octocat/hello-world" } });

    await waitFor(() =>
      expect(
        screen.getByText("/workspace/projects/octocat-hello-world")
      ).toBeInTheDocument()
    );
  });
});

describe("clone → analyze → preview", () => {
  it("clones first, then analyzes the path the clone reported", async () => {
    await renderPage();
    chooseGitHub();
    fireEvent.change(urlField(), {
      target: { value: "https://github.com/octocat/hello-world/tree/main" },
    });
    fireEvent.click(cloneButton());

    // The clone step is announced on its own — not folded into "Analyzing".
    expect(screen.getByRole("status")).toHaveTextContent("Cloning repository...");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Validate & Import/ })).toBeInTheDocument()
    );

    const clone = calls.find((c) => c.url.includes("/api/projects/clone"));
    const analyze = calls.find((c) => c.url.includes("/api/projects/import"));

    expect(clone?.body).toEqual({
      url: "https://github.com/octocat/hello-world/tree/main",
    });
    // Never the URL: analysis runs against the directory on disk.
    expect(analyze?.body).toEqual({ path: CLONE_DATA.path });
  });

  it("records the clone provenance when the project is created", async () => {
    await renderPage();
    chooseGitHub();
    fireEvent.change(urlField(), { target: { value: "octocat/hello-world" } });
    fireEvent.click(cloneButton());

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Validate & Import/ })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: /Validate & Import/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/proj-1"));

    const create = calls.find(
      (c) => c.url === "/api/projects" && c.method === "POST"
    );
    expect(create?.body).toMatchObject({
      gitRepoPath: CLONE_DATA.path,
      githubOwnerRepo: "octocat/hello-world",
      cloneSource: "github",
      gitRemoteUrl: CLONE_DATA.remoteUrl,
      defaultBranch: "main",
    });
  });

  it("leaves a local-folder import free of clone provenance", async () => {
    await renderPage();

    fireEvent.change(screen.getByPlaceholderText("/path/to/your/project"), {
      target: { value: "/home/user/code/legacy" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyze" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Validate & Import/ })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole("button", { name: /Validate & Import/ }));

    await waitFor(() => expect(push).toHaveBeenCalled());

    const create = calls.find(
      (c) => c.url === "/api/projects" && c.method === "POST"
    );
    // cloneSource is the ownership flag: Arij did not create this directory.
    expect(create?.body).not.toHaveProperty("cloneSource");
    expect(create?.body).toMatchObject({ gitRepoPath: "/home/user/code/legacy" });
    expect(calls.some((c) => c.url.includes("/clone"))).toBe(false);
  });

  it("announces a reused clone in the preview", async () => {
    mockFetch({
      "/api/projects/clone": { json: { data: { ...CLONE_DATA, reused: true } } },
    });

    await renderPage();
    chooseGitHub();
    fireEvent.change(urlField(), { target: { value: "octocat/hello-world" } });
    fireEvent.click(cloneButton());

    await waitFor(() =>
      expect(screen.getByText(/Reused the existing clone/)).toBeInTheDocument()
    );
  });
});

describe("clone failures", () => {
  it("returns to the source selection with the server's message", async () => {
    mockFetch({
      "/api/projects/clone": {
        ok: false,
        json: {
          error:
            "Repository not found: https://github.com/octocat/nope.git. If it is private, add a GitHub PAT in Settings.",
          code: "not_found",
        },
      },
    });

    await renderPage();
    chooseGitHub();
    fireEvent.change(urlField(), { target: { value: "octocat/nope" } });
    fireEvent.click(cloneButton());

    await waitFor(() =>
      expect(screen.getByText(/Repository not found/)).toBeInTheDocument()
    );

    // Back on the form, still on the GitHub source, URL preserved for a retry.
    expect(screen.getByRole("radio", { name: /GitHub URL/ })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(urlField()).toHaveValue("octocat/nope");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // Nothing was analyzed: the chain stopped at the clone.
    expect(calls.some((c) => c.url.includes("/api/projects/import"))).toBe(false);
  });

  it("surfaces a 409 conflict the same way", async () => {
    mockFetch({
      "/api/projects/clone": {
        ok: false,
        json: {
          error:
            "/workspace/projects/octocat-hello-world already holds a different repository. Move or remove it, then retry.",
          code: "conflict",
        },
      },
    });

    await renderPage();
    chooseGitHub();
    fireEvent.change(urlField(), { target: { value: "octocat/hello-world" } });
    fireEvent.click(cloneButton());

    await waitFor(() =>
      expect(
        screen.getByText(/already holds a different repository/)
      ).toBeInTheDocument()
    );
    expect(cloneButton()).toBeEnabled();
  });

  it("reports a network failure instead of hanging on the spinner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? "GET", body: null });
        if (url.includes("/api/projects/clone")) throw new Error("Failed to fetch");
        return {
          ok: true,
          json: async () => ({ data: {}, defaults: {} }),
        } as Response;
      })
    );

    await renderPage();
    chooseGitHub();
    fireEvent.change(urlField(), { target: { value: "octocat/hello-world" } });
    fireEvent.click(cloneButton());

    await waitFor(() =>
      expect(screen.getByText("Failed to fetch")).toBeInTheDocument()
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
