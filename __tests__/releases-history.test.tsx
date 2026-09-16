import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "p1" }),
}));

const ghConfig = vi.hoisted(() => ({
  isConfigured: true,
  ownerRepo: "orolol/arij" as string | null,
  tokenSet: true,
  loading: false,
}));
vi.mock("@/hooks/useGitHubConfig", () => ({
  useGitHubConfig: () => ghConfig,
}));

const git = vi.hoisted(() => ({
  ahead: 0,
  behind: 0,
  lastFetchedAt: null as number | null,
  lastFetchError: null as string | null,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
  push: vi.fn(async () => {}),
  pushing: false,
}));
vi.mock("@/hooks/useGitStatus", () => ({ useGitStatus: () => git }));

vi.mock("@/hooks/useWorktrees", () => ({
  useWorktrees: () => ({
    worktrees: [],
    count: null,
    orphanCount: 0,
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    prune: vi.fn(async () => {}),
    pruning: false,
  }),
}));

vi.mock("@/hooks/useNamedAgentsList", () => ({
  useNamedAgentsList: () => ({ agents: [], loading: false, refresh: vi.fn() }),
}));

const publishState = vi.hoisted(() => ({
  publish: vi.fn(async () => true),
  isPublishing: false,
  error: null as string | null,
}));
vi.mock("@/hooks/useReleasePublish", () => ({
  useReleasePublish: () => publishState,
}));

/** The page's SSE subscription: tests fire its handlers by hand. */
const events = vi.hoisted(() => ({
  handlers: {} as Record<string, (event: { data: Record<string, unknown> }) => void>,
}));
vi.mock("@/hooks/useProjectEvents", () => ({
  useProjectEvents: (
    _projectId: string,
    handlers: Record<string, (event: { data: Record<string, unknown> }) => void>
  ) => {
    events.handlers = handlers;
    return { pollTick: 0, connectionStatus: "connected" };
  },
}));

vi.mock("@/components/shared/NamedAgentSelect", () => ({
  NamedAgentSelect: () => <button type="button">agent</button>,
}));
vi.mock("@/components/shared/SessionPicker", () => ({
  SessionPicker: () => <button type="button">session</button>,
}));

import ReleasesPage from "@/app/projects/[projectId]/releases/page";

const DAY = 24 * 60 * 60 * 1000;

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

const PROJECT = {
  id: "p1",
  name: "Arij",
  defaultBranch: "main",
  gitRepoPath: "/repo",
  githubOwnerRepo: "orolol/arij",
};

/** Published: the publish route stamped publishedAt. Carries a tag, and one id whose epic is gone. */
const PUBLISHED = {
  id: "r1",
  version: "0.4.2",
  title: null,
  changelog: "# 0.4.2\n\n## Features\n- Session artifact gallery\n",
  epicIds: '["e3","gone1234567"]',
  releaseBranch: "release/v0.4.2",
  gitTag: "v0.4.2",
  githubReleaseId: 10,
  githubReleaseUrl: "https://github.com/orolol/arij/releases/10",
  pushedAt: iso(4 * DAY),
  publishedAt: iso(3 * DAY),
  createdAt: iso(4 * DAY),
};

/** Local: a tag, no GitHub release at all, and no recorded tickets. */
const LOCAL = {
  id: "r2",
  version: "0.4.1",
  title: null,
  changelog: null,
  epicIds: null,
  releaseBranch: "release/v0.4.1",
  gitTag: "v0.4.1",
  githubReleaseId: null,
  githubReleaseUrl: null,
  pushedAt: null,
  publishedAt: null,
  createdAt: iso(14 * DAY),
};

/**
 * Draft: exactly what POST /releases writes with "GitHub draft" on — a tag,
 * a GitHub id, `pushedAt` stamped at creation, and no `publishedAt` (#105).
 * The fixture used to carry `pushedAt: null`, a shape the server never
 * produced, which is how the unreachable Publish button stayed green.
 */
const DRAFT = {
  id: "r3",
  version: "0.4.0",
  title: null,
  changelog: "# 0.4.0\n\n## Features\n- Provider matrix doc\n\n### Notes\n- rien\n",
  epicIds: '["e5"]',
  releaseBranch: "release/v0.4.0",
  gitTag: "v0.4.0",
  githubReleaseId: 9,
  githubReleaseUrl: "https://github.com/orolol/arij/releases/9",
  pushedAt: iso(31 * DAY),
  publishedAt: null,
  createdAt: iso(31 * DAY),
};

const EPICS = [
  {
    id: "e3",
    title: "Session artifact gallery",
    status: "done",
    type: "feature",
    readableId: "ARJ-96",
    releaseId: "r1",
    usCount: 1,
    usDone: 1,
    updatedAt: iso(4 * DAY),
  },
  {
    id: "e5",
    title: "Provider matrix doc",
    status: "done",
    type: "feature",
    readableId: "ARJ-90",
    releaseId: "r3",
    usCount: 1,
    usDone: 1,
    updatedAt: iso(31 * DAY),
  },
];

const state = vi.hoisted(() => ({
  releases: [] as Record<string, unknown>[],
  epics: [] as Record<string, unknown>[],
  patch: { ok: true, status: 200, body: { data: {} } as Record<string, unknown> },
}));

function jsonRes(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === "PATCH") {
    return {
      ok: state.patch.ok,
      status: state.patch.status,
      json: async () => state.patch.body,
    } as unknown as Response;
  }
  if (url === "/api/projects/p1/releases") return jsonRes({ data: state.releases });
  if (url === "/api/projects/p1/epics") return jsonRes({ data: state.epics });
  if (url === "/api/projects/p1") return jsonRes({ data: PROJECT });
  return jsonRes({ data: null });
});

async function renderPage() {
  const result = render(<ReleasesPage />);
  await waitFor(() =>
    expect(screen.getByTestId("release-stat-shipped").textContent).not.toContain(
      "—"
    )
  );
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.releases = [PUBLISHED, LOCAL, DRAFT];
  state.epics = EPICS;
  state.patch = { ok: true, status: 200, body: { data: {} } };
  events.handlers = {};
  ghConfig.isConfigured = true;
  publishState.error = null;
  publishState.isPublishing = false;
  publishState.publish.mockResolvedValue(true);
  vi.stubGlobal("fetch", fetchMock);
  if (!globalThis.crypto?.randomUUID) {
    vi.stubGlobal("crypto", {
      ...globalThis.crypto,
      randomUUID: () => Math.random().toString(36).slice(2),
    });
  }
});

describe("Release history — stamps", () => {
  it("carries the state in the word, on one shared pool ground", async () => {
    await renderPage();

    const published = screen.getByTestId("release-history-row-r1");
    expect(within(published).getByText("TAG")).toBeInTheDocument();
    expect(within(published).getByText("GH RELEASE")).toBeInTheDocument();

    const local = screen.getByTestId("release-history-row-r2");
    expect(within(local).getByText("TAG")).toBeInTheDocument();
    expect(within(local).queryByText("GH RELEASE")).toBeNull();
    expect(within(local).queryByText("GH DRAFT")).toBeNull();

    const draft = screen.getByTestId("release-history-row-r3");
    expect(within(draft).getByText("TAG")).toBeInTheDocument();
    expect(within(draft).getByText("GH DRAFT")).toBeInTheDocument();
    expect(within(draft).queryByText("GH RELEASE")).toBeNull();
  });

  it("prints the version and its ticket count", async () => {
    await renderPage();
    const row = screen.getByTestId("release-history-row-r1");
    expect(within(row).getByText("v0.4.2")).toBeInTheDocument();
    expect(within(row).getByText(/^2 tickets · /)).toBeInTheDocument();
    expect(
      within(screen.getByTestId("release-history-row-r3")).getByText(
        /^1 ticket · /
      )
    ).toBeInTheDocument();
  });
});

describe("Release history — expansion", () => {
  it("expands one row at a time and collapses on a second click", async () => {
    const user = userEvent.setup();
    await renderPage();

    const first = screen.getByTestId("release-history-row-r1");
    expect(first).toHaveAttribute("aria-expanded", "false");

    await user.click(first);
    expect(screen.getByTestId("release-history-row-r1")).toHaveAttribute(
      "aria-expanded",
      "true"
    );
    expect(
      within(screen.getByTestId("release-history-tickets-r1")).getByText(
        "ARJ-96 · Session artifact gallery"
      )
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("release-history-row-r3"));
    expect(screen.getByTestId("release-history-row-r1")).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByTestId("release-history-tickets-r1")).toBeNull();
    expect(screen.getByTestId("release-history-tickets-r3")).toBeInTheDocument();

    await user.click(screen.getByTestId("release-history-row-r3"));
    expect(screen.queryByTestId("release-history-tickets-r3")).toBeNull();
  });

  it("renders a deleted epic's recorded id with an em-dash title", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByTestId("release-history-row-r1"));
    expect(
      within(screen.getByTestId("release-history-tickets-r1")).getByText(
        "gone1234 · —"
      )
    ).toBeInTheDocument();
  });

  it("says so when a release recorded no tickets", async () => {
    const user = userEvent.setup();
    await renderPage();

    await user.click(screen.getByTestId("release-history-row-r2"));
    expect(
      within(screen.getByTestId("release-history-tickets-r2")).getByText(
        "no tickets recorded"
      )
    ).toBeInTheDocument();
  });
});

describe("Release history — inspect mode", () => {
  async function openInspect(releaseId: string) {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByTestId(`release-history-row-${releaseId}`));
    await user.click(
      within(
        screen.getByTestId(`release-history-tickets-${releaseId}`)
      ).getByText("view the changelog →")
    );
    return user;
  }

  it("swaps the band to the release's changelog and back", async () => {
    const user = await openInspect("r1");

    expect(screen.getByText("Release")).toBeInTheDocument();
    expect(screen.queryByText("Next release")).toBeNull();
    expect(screen.getByTestId("release-changelog").textContent).toContain(
      "- Session artifact gallery"
    );
    expect(screen.getByTestId("release-version-pill").textContent).toBe("v0.4.2");
    expect(screen.getByText("published")).toBeInTheDocument();

    await user.click(screen.getByText("← back to draft"));
    expect(screen.getByText("Next release")).toBeInTheDocument();
  });

  it("offers View on GitHub only when the release has a URL", async () => {
    await openInspect("r1");
    expect(screen.getByTestId("release-view-on-github")).toHaveAttribute(
      "href",
      "https://github.com/orolol/arij/releases/10"
    );
  });

  it("does not offer Publish for a published release", async () => {
    await openInspect("r1");
    expect(screen.queryByTestId("release-publish-button")).toBeNull();
  });

  it("publishes a draft release and reloads on success", async () => {
    const user = await openInspect("r3");

    const publish = screen.getByTestId("release-publish-button");
    expect(publish).toBeInTheDocument();
    const loadsBefore = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/projects/p1/epics"
    ).length;

    await user.click(publish);

    expect(publishState.publish).toHaveBeenCalledWith("r3");
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(
          ([url]) => String(url) === "/api/projects/p1/epics"
        ).length
      ).toBe(loadsBefore + 1)
    );
  });

  it("renders a publish failure inline and does not reload", async () => {
    publishState.publish.mockResolvedValue(false);
    publishState.error = "Release already published";
    const user = await openInspect("r3");

    const loadsBefore = fetchMock.mock.calls.filter(
      ([url]) => String(url) === "/api/projects/p1/epics"
    ).length;
    await user.click(screen.getByTestId("release-publish-button"));

    expect(screen.getByTestId("release-publish-error").textContent).toBe(
      "Release already published"
    );
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => String(url) === "/api/projects/p1/epics"
      ).length
    ).toBe(loadsBefore);
  });

  it("hides Publish when GitHub is not configured", async () => {
    ghConfig.isConfigured = false;
    await openInspect("r3");
    expect(screen.queryByTestId("release-publish-button")).toBeNull();
  });

  it("summarises the recorded tag and branch, dropping the null clauses", async () => {
    await openInspect("r1");
    expect(
      screen.getByText("2 tickets · tag v0.4.2 on release/v0.4.2")
    ).toBeInTheDocument();
  });
});

describe("Release history — empty", () => {
  it("keeps the History label and says there are none yet", async () => {
    state.releases = [];
    await renderPage();

    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText("No releases yet")).toBeInTheDocument();
    expect(screen.queryByTestId("release-history-list")).toBeNull();
  });
});

function releaseLoads(): number {
  return fetchMock.mock.calls.filter(
    ([url, init]) =>
      String(url) === "/api/projects/p1/releases" &&
      (init as RequestInit | undefined)?.method === undefined
  ).length;
}

async function inspect(releaseId: string) {
  const user = userEvent.setup();
  await renderPage();
  await user.click(screen.getByTestId(`release-history-row-${releaseId}`));
  await user.click(
    within(screen.getByTestId(`release-history-tickets-${releaseId}`)).getByText(
      "view the changelog →"
    )
  );
  return user;
}

describe("Release history — editing (#117)", () => {
  it("edits the title and the changelog of an unpublished release, then reloads", async () => {
    const user = await inspect("r3");
    const loadsBefore = releaseLoads();

    await user.click(screen.getByTestId("release-edit-button"));

    const editor = screen.getByTestId("release-changelog-editor");
    expect(editor).toHaveValue(DRAFT.changelog);
    await user.clear(editor);
    await user.type(editor, "# 0.4.0 fixed");
    await user.type(screen.getByTestId("release-edit-title-input"), "Autumn");
    await user.click(screen.getByTestId("release-edit-save"));

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(patchCall?.[0]).toBe("/api/projects/p1/releases/r3");
    // Each changed field travels with the value the editor was seeded with,
    // so the server can refuse an edit made over a row that has since moved.
    expect(JSON.parse(String((patchCall?.[1] as RequestInit).body))).toEqual({
      title: "Autumn",
      expectedTitle: null,
      changelog: "# 0.4.0 fixed",
      expectedChangelog: DRAFT.changelog,
    });
    await waitFor(() => expect(releaseLoads()).toBe(loadsBefore + 1));
    // Back to reading once saved.
    expect(screen.queryByTestId("release-changelog-editor")).toBeNull();
  });

  it("keeps the editor open and says why when the edit is refused", async () => {
    state.patch = {
      ok: false,
      status: 502,
      body: { error: "GitHub refused the edit: rate limited" },
    };
    const user = await inspect("r3");

    await user.click(screen.getByTestId("release-edit-button"));
    await user.type(screen.getByTestId("release-changelog-editor"), "!");
    await user.click(screen.getByTestId("release-edit-save"));

    expect(await screen.findByTestId("release-edit-error")).toHaveTextContent(
      "GitHub refused the edit: rate limited"
    );
    expect(screen.getByTestId("release-changelog-editor")).toBeInTheDocument();
  });

  it("discards the draft edit on cancel", async () => {
    const user = await inspect("r2");

    await user.click(screen.getByTestId("release-edit-button"));
    await user.click(screen.getByTestId("release-edit-cancel"));

    expect(screen.queryByTestId("release-changelog-editor")).toBeNull();
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH"
      )
    ).toBe(false);
  });

  it("sends only the fields that changed: a title edit never resends the changelog", async () => {
    const user = await inspect("r3");

    await user.click(screen.getByTestId("release-edit-button"));
    await user.type(screen.getByTestId("release-edit-title-input"), "Autumn");
    await user.click(screen.getByTestId("release-edit-save"));

    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH"
    );
    expect(JSON.parse(String((patchCall?.[1] as RequestInit).body))).toEqual({
      title: "Autumn",
      expectedTitle: null,
    });
  });

  it("closes without a request when nothing changed", async () => {
    const user = await inspect("r3");

    await user.click(screen.getByTestId("release-edit-button"));
    await user.click(screen.getByTestId("release-edit-save"));

    await waitFor(() =>
      expect(screen.queryByTestId("release-changelog-editor")).toBeNull()
    );
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "PATCH"
      )
    ).toBe(false);
  });

  it("says the release moved under the editor when the server reports a stale edit", async () => {
    state.patch = {
      ok: false,
      status: 409,
      body: { error: "The release changed since it was opened for editing.", code: "release_changed" },
    };
    const user = await inspect("r3");

    await user.click(screen.getByTestId("release-edit-button"));
    await user.type(screen.getByTestId("release-changelog-editor"), "!");
    await user.click(screen.getByTestId("release-edit-save"));

    expect(await screen.findByTestId("release-edit-error")).toHaveTextContent(
      "This release changed while you were editing it"
    );
  });

  it("says the release is being tagged when the server refuses an edit mid-finalisation", async () => {
    state.patch = {
      ok: false,
      status: 409,
      body: { error: "The release is being tagged; try again in a moment.", code: "release_finalizing" },
    };
    const user = await inspect("r3");

    await user.click(screen.getByTestId("release-edit-button"));
    await user.type(screen.getByTestId("release-changelog-editor"), "!");
    await user.click(screen.getByTestId("release-edit-save"));

    expect(await screen.findByTestId("release-edit-error")).toHaveTextContent(
      "being tagged"
    );
  });

  it("offers no edit on a published release", async () => {
    await inspect("r1");
    expect(screen.queryByTestId("release-edit-button")).toBeNull();
  });

  it("shows the release title in inspect mode", async () => {
    state.releases = [{ ...DRAFT, title: "Autumn" }];
    await inspect("r3");
    expect(screen.getByTestId("release-inspect-title")).toHaveTextContent("Autumn");
  });
});

describe("Release history — changelog in progress (#109)", () => {
  const PENDING = {
    ...LOCAL,
    id: "r4",
    version: "0.4.3",
    gitTag: null,
    releaseBranch: null,
    changelog: "# 0.4.3\n\n## Features\n- Something\n",
    epicIds: '["e3"]',
    changelogPending: true,
    createdAt: iso(0),
  };

  it("says the changelog is still being written, in words", async () => {
    state.releases = [PENDING, PUBLISHED];
    await renderPage();

    const row = screen.getByTestId("release-history-row-r4");
    expect(within(row).getByText("changelog in progress")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("release-history-row-r1")).queryByText(
        "changelog in progress"
      )
    ).toBeNull();
  });

  it("reloads when the server announces the release finished", async () => {
    state.releases = [PENDING];
    await renderPage();
    const loadsBefore = releaseLoads();

    events.handlers["release:updated"]?.({ data: { releaseId: "r4" } });

    await waitFor(() => expect(releaseLoads()).toBe(loadsBefore + 1));
  });

  it("keeps reloading while a release is pending, so the server can reconcile it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      state.releases = [PENDING];
      await renderPage();
      const loadsBefore = releaseLoads();

      // No event arrives: the run was cancelled while queued elsewhere.
      await vi.advanceTimersByTimeAsync(15_000);

      await waitFor(() => expect(releaseLoads()).toBe(loadsBefore + 1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll when nothing is pending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      state.releases = [PUBLISHED];
      await renderPage();
      const loadsBefore = releaseLoads();

      await vi.advanceTimersByTimeAsync(45_000);

      expect(releaseLoads()).toBe(loadsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it("raises an error toast for a GitHub failure that happened in the background", async () => {
    state.releases = [PENDING];
    await renderPage();

    events.handlers["release:updated"]?.({
      data: {
        releaseId: "r4",
        githubErrors: ["GitHub release creation failed: boom"],
      },
    });

    const toast = await screen.findByTestId("release-toast");
    expect(toast).toHaveAttribute("data-toast-type", "error");
    expect(toast.textContent).toContain("v0.4.3");
    expect(toast.textContent).toContain("GitHub release creation failed: boom");
  });
});

describe("Release history — finalisation failures stay on the row", () => {
  const FAILED = {
    ...LOCAL,
    id: "r5",
    version: "0.4.4",
    epicIds: '["e3"]',
    finalizeErrors: ["GitHub release creation failed: boom", "Tag push failed: no origin"],
    createdAt: iso(0),
  };

  it("says so in the history, at every load", async () => {
    state.releases = [FAILED, PUBLISHED];
    await renderPage();

    expect(
      within(screen.getByTestId("release-history-row-r5")).getByText("sync failed")
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("release-history-row-r1")).queryByText("sync failed")
    ).toBeNull();
  });

  it("spells the failures out in inspect mode", async () => {
    state.releases = [FAILED];
    await inspect("r5");

    const errors = screen.getByTestId("release-finalize-errors");
    expect(errors).toHaveTextContent("GitHub release creation failed: boom");
    expect(errors).toHaveTextContent("Tag push failed: no origin");
  });
});
