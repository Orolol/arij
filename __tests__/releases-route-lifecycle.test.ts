/**
 * Lot 11 — the release route's lifecycle, driven against a real migrated
 * SQLite database, a real temporary Git repository and the real background
 * dispatcher. Only the CLI process and GitHub are stubbed.
 *
 *  #109  POST /releases used to hold the HTTP request open for the whole
 *        changelog agent run (no timeout) through a hand-copied session
 *        lifecycle. The release is now claimed at once and the changelog run
 *        goes through `dispatchBackgroundSession`; the tag, the CHANGELOG
 *        commit and the GitHub draft follow when the changelog is final.
 *  #202  The run used to appear twice in /sessions/active: its
 *        `agent_sessions` row AND an activity-registry entry.
 *  #105  A GitHub draft was classed "published" the moment it was created,
 *        because `pushedAt` was stamped at creation. `published_at` is now
 *        its own column, written only by the publish route.
 *  #117  The title and the changelog can be edited after creation (PATCH).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import fs from "fs";
import os from "os";
import path from "path";
import simpleGit, { type SimpleGit } from "simple-git";
import { initDb } from "@/lib/db/init";
import * as schema from "@/lib/db/schema";
import { mockNextRequest, mockRouteContext } from "@/__tests__/helpers/db-mock";
import { eventBus, type TicketEvent } from "@/lib/events/bus";
import { releaseState } from "@/components/releases/derive";

/* ------------------------------------------------------------------ */
/* Real database, real schema                                          */
/* ------------------------------------------------------------------ */
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const testSqlite = new Database(path.join(tempDir("arij-release-life-db-"), "arij.db"));
initDb(testSqlite);
const testDb = drizzle(testSqlite, { schema });

vi.mock("@/lib/db", () => ({ db: testDb, sqlite: testSqlite }));

/* ------------------------------------------------------------------ */
/* Stub only what would reach outside the process                      */
/* ------------------------------------------------------------------ */
type RunResult = { success: boolean; result?: string; error?: string };

const runs = vi.hoisted(() => ({
  /** sessionId → resolver of that session's pending completion. */
  resolvers: new Map<string, (result: RunResult) => void>(),
}));

const mockProcessStart = vi.hoisted(() => vi.fn());
vi.mock("@/lib/claude/process-manager", () => ({
  processManager: {
    start: mockProcessStart,
    getStatus: vi.fn(() => null),
    cancel: vi.fn(),
  },
}));
vi.mock("@/lib/agent-sessions/wait-for-completion", () => ({
  DEFAULT_COMPLETION_POLL_INTERVAL_MS: 2000,
  waitForProcessCompletion: vi.fn(
    (sessionId: string) =>
      new Promise((resolve) => {
        runs.resolvers.set(sessionId, (result: RunResult) =>
          resolve({ status: result.success ? "completed" : "failed", result })
        );
      })
  ),
}));

const mockCreateDraftRelease = vi.hoisted(() => vi.fn());
const mockUpdateDraftRelease = vi.hoisted(() => vi.fn());
const mockPublishRelease = vi.hoisted(() => vi.fn());
const mockGetRelease = vi.hoisted(() => vi.fn());
vi.mock("@/lib/github/releases", () => ({
  createDraftRelease: mockCreateDraftRelease,
  updateDraftRelease: mockUpdateDraftRelease,
  publishRelease: mockPublishRelease,
  getRelease: mockGetRelease,
}));
vi.mock("@/lib/github/sync-log", () => ({ logSyncOperation: vi.fn() }));
const mockWebhook = vi.hoisted(() => vi.fn());
vi.mock("@/lib/webhooks/send", () => ({ sendProjectWebhook: mockWebhook }));
const mockSpecRewrite = vi.hoisted(() => vi.fn());
vi.mock("@/lib/workflow/spec-auto-rewrite", () => ({
  maybeAutoRewriteSpecAfterRelease: mockSpecRewrite,
}));

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const SESSIONS_DIR = path.join(process.cwd(), "data", "sessions");

function sessionDirNames(): Set<string> {
  try {
    return new Set(fs.readdirSync(SESSIONS_DIR));
  } catch {
    return new Set();
  }
}

const sessionDirsBefore = sessionDirNames();

async function createTempRepo(): Promise<{ dir: string; git: SimpleGit }> {
  const dir = tempDir("arij-release-life-repo-");
  const git = simpleGit(dir);
  await git.init();
  await git.addConfig("user.name", "Arij Test");
  await git.addConfig("user.email", "arij@example.com");
  fs.writeFileSync(path.join(dir, "README.md"), "# Test\n", "utf-8");
  await git.add(["README.md"]);
  await git.commit("chore: initial");
  await git.branch(["-M", "main"]);
  return { dir, git };
}

async function refNames(git: SimpleGit): Promise<string[]> {
  const raw = await git.raw(["show-ref"]).catch(() => "");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" ")[1]);
}

let seq = 0;

function seedProject(gitRepoPath: string, githubOwnerRepo?: string): string {
  const id = `proj_life_${++seq}`;
  testDb
    .insert(schema.projects)
    .values({
      id,
      name: `Release Lifecycle ${id}`,
      gitRepoPath,
      defaultBranch: "main",
      githubOwnerRepo: githubOwnerRepo ?? null,
    })
    .run();
  return id;
}

function seedEpic(projectId: string, title: string, status = "done"): string {
  const id = `ep_${projectId}_${++seq}`;
  testDb
    .insert(schema.epics)
    .values({ id, projectId, title, description: "desc", status })
    .run();
  return id;
}

function releaseRow(projectId: string) {
  return testDb
    .select()
    .from(schema.releases)
    .where(eq(schema.releases.projectId, projectId))
    .get();
}

function sessionRows(projectId: string) {
  return testDb
    .select()
    .from(schema.agentSessions)
    .where(eq(schema.agentSessions.projectId, projectId))
    .all();
}

async function postRelease(projectId: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/projects/[projectId]/releases/route");
  return POST(
    mockNextRequest({
      url: `http://localhost/api/projects/${projectId}/releases`,
      method: "POST",
      body,
    }),
    mockRouteContext({ projectId })
  );
}

async function getReleases(projectId: string) {
  const { GET } = await import("@/app/api/projects/[projectId]/releases/route");
  const res = await GET(mockNextRequest(), mockRouteContext({ projectId }));
  return (await res.json()).data as Array<Record<string, unknown>>;
}

async function patchRelease(
  projectId: string,
  releaseId: string,
  body: Record<string, unknown>
) {
  const { PATCH } = await import(
    "@/app/api/projects/[projectId]/releases/[releaseId]/route"
  );
  return PATCH(
    mockNextRequest({
      url: `http://localhost/api/projects/${projectId}/releases/${releaseId}`,
      method: "PATCH",
      body,
    }),
    mockRouteContext({ projectId, releaseId })
  );
}

async function publish(projectId: string, releaseId: string) {
  const { POST } = await import(
    "@/app/api/projects/[projectId]/releases/[releaseId]/publish/route"
  );
  return POST(
    mockNextRequest({
      url: `http://localhost/api/projects/${projectId}/releases/${releaseId}/publish`,
      method: "POST",
    }),
    mockRouteContext({ projectId, releaseId })
  );
}

async function cancelSession(projectId: string, sessionId: string) {
  const { DELETE } = await import(
    "@/app/api/projects/[projectId]/sessions/[sessionId]/route"
  );
  return DELETE(
    mockNextRequest({
      url: `http://localhost/api/projects/${projectId}/sessions/${sessionId}`,
      method: "DELETE",
    }),
    mockRouteContext({ projectId, sessionId })
  );
}

/**
 * Holds the project's only scheduler slot, so the next background dispatch
 * stays `queued`. Returns the release of that slot.
 */
async function occupyTheOnlySlot(projectId: string): Promise<() => void> {
  const { agentScheduler } = await import("@/lib/agents/scheduler");
  testDb
    .insert(schema.settings)
    .values({ key: `agent_max_concurrent:${projectId}`, value: "1" })
    .run();
  let free!: () => void;
  const held = new Promise<void>((resolve) => {
    free = resolve;
  });
  agentScheduler.submit(projectId, `slot-holder-${projectId}`, () => held);
  return free;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Completes the (single) pending changelog run of a project. */
function completeRun(sessionId: string, result: RunResult) {
  const resolve = runs.resolvers.get(sessionId);
  if (!resolve) throw new Error(`no pending run for ${sessionId}`);
  runs.resolvers.delete(sessionId);
  resolve(result);
}

const AGENT_CHANGELOG = [
  "# 0.9.0",
  "",
  "## Features",
  "- Written by the changelog agent",
  "",
  "## Bugfixes",
  "- None",
  "",
  "## Breaking Changes",
  "- None",
].join("\n");

beforeEach(() => {
  vi.clearAllMocks();
  runs.resolvers.clear();
  mockCreateDraftRelease.mockResolvedValue({
    id: 77,
    url: "https://github.com/owner/repo/releases/77",
    htmlUrl: "https://github.com/owner/repo/releases/77",
    draft: true,
    tagName: "v0.9.0",
  });
  // PATCH asks GitHub whether a draft is still a draft before editing it.
  mockGetRelease.mockResolvedValue({ id: 77, draft: true });
});

afterEach(() => {
  for (const name of sessionDirNames()) {
    if (!sessionDirsBefore.has(name)) {
      fs.rmSync(path.join(SESSIONS_DIR, name), { recursive: true, force: true });
    }
  }
});

afterAll(() => {
  testSqlite.close();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* #109 — the changelog runs in the background                         */
/* ------------------------------------------------------------------ */
describe("POST /releases — the changelog agent runs in the background (#109)", () => {
  it("answers 201 while the agent is still running, with the release already claimed", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Shipped feature");

    // The run never completes during this test: an answer at all proves the
    // request no longer waits for it.
    const res = await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    const sessions = sessionRows(projectId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].agentType).toBe("release_notes");
    expect(json.data.changelogSessionId).toBe(sessions[0].id);

    const row = releaseRow(projectId);
    expect(row?.version).toBe("0.9.0");
    expect(row?.changelogSessionId).toBe(sessions[0].id);
    // The fallback changelog stands in until the agent delivers.
    expect(row?.changelog).toContain("- Shipped feature");

    // The epics are released at claim time, not minutes later.
    const epic = testDb.select().from(schema.epics).where(eq(schema.epics.id, epicId)).get();
    expect(epic?.status).toBe("released");
    expect(epic?.releaseId).toBe(row?.id);
  });

  it("reports the release as changelog-pending until the run is over", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Pending feature");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
    });

    const [pending] = await getReleases(projectId);
    expect(pending.changelogPending).toBe(true);

    const sessionId = sessionRows(projectId)[0].id;
    completeRun(sessionId, { success: true, result: AGENT_CHANGELOG });

    await vi.waitFor(() => expect(releaseRow(projectId)?.gitTag).toBe("v0.9.0"));
    const [done] = await getReleases(projectId);
    expect(done.changelogPending).toBe(false);
  });

  it("tags and commits the agent's changelog once the run completes", async () => {
    const { dir, git } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Shipped feature");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
    });

    // Nothing reaches the repository while the changelog is still coming:
    // the committed CHANGELOG.md must be the final one.
    expect(await refNames(git)).not.toContain("refs/tags/v0.9.0");

    const sessionId = sessionRows(projectId)[0].id;
    completeRun(sessionId, { success: true, result: AGENT_CHANGELOG });

    await vi.waitFor(() => expect(releaseRow(projectId)?.gitTag).toBe("v0.9.0"));

    const row = releaseRow(projectId);
    expect(row?.changelog).toContain("- Written by the changelog agent");
    expect(row?.releaseBranch).toBe("release/v0.9.0");
    expect(await refNames(git)).toContain("refs/tags/v0.9.0");
    const committed = await git.raw(["show", "v0.9.0:CHANGELOG.md"]);
    expect(committed).toContain("- Written by the changelog agent");

    // The session row is finalised by the shared dispatcher.
    await vi.waitFor(() =>
      expect(sessionRows(projectId)[0].status).toBe("completed")
    );
  });

  it("keeps the fallback changelog and still tags when the agent fails", async () => {
    const { dir, git } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Fallback feature");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
    });

    completeRun(sessionRows(projectId)[0].id, { success: false, error: "boom" });

    await vi.waitFor(() => expect(releaseRow(projectId)?.gitTag).toBe("v0.9.0"));
    expect(releaseRow(projectId)?.changelog).toContain("- Fallback feature");
    expect(await git.raw(["show", "v0.9.0:CHANGELOG.md"])).toContain(
      "- Fallback feature"
    );
  });

  it("does not let the agent overwrite a changelog the user edited during the run", async () => {
    const { dir, git } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Edited feature");

    const res = await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
    });
    const releaseId = (await res.json()).data.release.id as string;

    const edited = "# 0.9.0\n\n## Features\n- Hand-written by the user\n";
    const patchRes = await patchRelease(projectId, releaseId, { changelog: edited });
    expect(patchRes.status).toBe(200);

    completeRun(sessionRows(projectId)[0].id, { success: true, result: AGENT_CHANGELOG });

    await vi.waitFor(() => expect(releaseRow(projectId)?.gitTag).toBe("v0.9.0"));
    expect(releaseRow(projectId)?.changelog).toBe(edited);
    expect(await git.raw(["show", "v0.9.0:CHANGELOG.md"])).toContain(
      "- Hand-written by the user"
    );
  });

  it("announces the finished release by event, carrying any GitHub error", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir, "owner/repo");
    const epicId = seedEpic(projectId, "Evented feature");
    mockCreateDraftRelease.mockRejectedValueOnce(new Error("GitHub is down"));

    const events: TicketEvent[] = [];
    const unsubscribe = eventBus.subscribe(projectId, (event) => events.push(event));

    try {
      await postRelease(projectId, {
        version: "0.9.0",
        epicIds: [epicId],
        generateChangelog: true,
        pushToGitHub: true,
      });
      completeRun(sessionRows(projectId)[0].id, { success: true, result: AGENT_CHANGELOG });

      await vi.waitFor(() =>
        expect(events.some((e) => e.type === "release:updated")).toBe(true)
      );
    } finally {
      unsubscribe();
    }

    const updated = events.find((e) => e.type === "release:updated")!;
    expect(updated.data.releaseId).toBe(releaseRow(projectId)?.id);
    // The temp repo has no `origin`, so the tag push fails as well.
    expect(updated.data.githubErrors).toEqual(
      expect.arrayContaining([expect.stringContaining("GitHub is down")])
    );
    // The outbound signals wait for the final changelog.
    expect(mockWebhook).toHaveBeenCalledTimes(1);
    expect(mockSpecRewrite).toHaveBeenCalledTimes(1);
  });

  it("resumes the chosen CLI session through the shared dispatcher", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Resumed feature");
    testDb
      .insert(schema.agentSessions)
      .values({
        id: "previous-release-session",
        projectId,
        status: "completed",
        mode: "plan",
        provider: "claude-code",
        cliSessionId: "cli-previous-1",
        agentType: "release_notes",
      })
      .run();

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
      resumeSessionId: "previous-release-session",
    });

    expect(mockProcessStart).toHaveBeenCalledTimes(1);
    const [, options] = mockProcessStart.mock.calls[0];
    expect(options).toMatchObject({
      cliSessionId: "cli-previous-1",
      resumeSession: true,
      mode: "plan",
    });
  });

  it("refuses a second release of a version that already exists", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir);
    const first = seedEpic(projectId, "First");
    const second = seedEpic(projectId, "Second");

    const res1 = await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [first],
      generateChangelog: false,
    });
    expect(res1.status).toBe(201);

    const res2 = await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [second],
      generateChangelog: false,
    });
    expect(res2.status).toBe(409);
    const epic = testDb.select().from(schema.epics).where(eq(schema.epics.id, second)).get();
    expect(epic?.status).toBe("done");
  });
});

/* ------------------------------------------------------------------ */
/* #202 — one live record per changelog run                            */
/* ------------------------------------------------------------------ */
describe("POST /releases — one live record per run (#202)", () => {
  it("registers no activity-registry entry next to the release_notes session", async () => {
    const { activityRegistry } = await import("@/lib/activity-registry");
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Single-record feature");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
    });

    expect(sessionRows(projectId)).toHaveLength(1);
    expect(activityRegistry.listByProject(projectId)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* #105 — a GitHub draft is a draft until the publish route runs       */
/* ------------------------------------------------------------------ */
describe("GitHub draft → publish (#105)", () => {
  it("creates a draft that reads as a draft, and only publish makes it published", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir, "owner/repo");
    const epicId = seedEpic(projectId, "Drafted feature");

    const res = await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: false,
      pushToGitHub: true,
    });
    expect(res.status).toBe(201);

    const created = releaseRow(projectId)!;
    expect(created.githubReleaseId).toBe(77);
    // Pushed to GitHub, but not published.
    expect(created.pushedAt).not.toBeNull();
    expect(created.publishedAt).toBeNull();
    expect(releaseState(created)).toBe("draft");

    mockGetRelease.mockResolvedValue({ id: 77, draft: true });
    mockPublishRelease.mockResolvedValue({
      id: 77,
      htmlUrl: "https://github.com/owner/repo/releases/tag/v0.9.0",
      url: "https://github.com/owner/repo/releases/tag/v0.9.0",
      draft: false,
      tagName: "v0.9.0",
    });
    const pub = await publish(projectId, created.id);
    expect(pub.status).toBe(200);

    const published = releaseRow(projectId)!;
    expect(published.publishedAt).toEqual(expect.any(String));
    expect(published.pushedAt).toBe(created.pushedAt);
    expect(releaseState(published)).toBe("published");
  });

  it("records a release already published on GitHub instead of offering Publish forever", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir, "owner/repo");
    const epicId = seedEpic(projectId, "Published elsewhere");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: false,
      pushToGitHub: true,
    });
    const created = releaseRow(projectId)!;

    mockGetRelease.mockResolvedValue({ id: 77, draft: false });
    const pub = await publish(projectId, created.id);
    expect(pub.status).toBe(409);
    expect(releaseRow(projectId)?.publishedAt).toEqual(expect.any(String));
  });
});

/* ------------------------------------------------------------------ */
/* #117 — title and changelog are editable                             */
/* ------------------------------------------------------------------ */
describe("PATCH /releases/:id (#117)", () => {
  it("stores the title sent at creation", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Titled feature");

    await postRelease(projectId, {
      version: "0.9.0",
      title: "Autumn",
      epicIds: [epicId],
      generateChangelog: false,
    });
    expect(releaseRow(projectId)?.title).toBe("Autumn");
  });

  it("edits the title and the changelog, and mirrors them onto the GitHub draft", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir, "owner/repo");
    const epicId = seedEpic(projectId, "Editable feature");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: false,
      pushToGitHub: true,
    });
    const created = releaseRow(projectId)!;
    mockUpdateDraftRelease.mockResolvedValue({ id: 77 });

    const res = await patchRelease(projectId, created.id, {
      title: "Renamed",
      changelog: "# 0.9.0\n\n## Features\n- Fixed wording\n",
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.title).toBe("Renamed");
    expect(json.data.changelog).toContain("- Fixed wording");
    expect(mockUpdateDraftRelease).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      releaseId: 77,
      title: "v0.9.0 — Renamed",
      body: "# 0.9.0\n\n## Features\n- Fixed wording\n",
    });
  });

  it("leaves the row untouched when GitHub refuses the edit", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir, "owner/repo");
    const epicId = seedEpic(projectId, "Refused edit");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: false,
      pushToGitHub: true,
    });
    const created = releaseRow(projectId)!;
    mockUpdateDraftRelease.mockRejectedValue(new Error("rate limited"));

    const res = await patchRelease(projectId, created.id, { changelog: "# nope\n" });

    expect(res.status).toBe(502);
    expect(releaseRow(projectId)?.changelog).toBe(created.changelog);
  });

  it("refuses to edit a published release", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Frozen feature");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: false,
    });
    const created = releaseRow(projectId)!;
    testDb
      .update(schema.releases)
      .set({ publishedAt: new Date().toISOString() })
      .where(eq(schema.releases.id, created.id))
      .run();

    const res = await patchRelease(projectId, created.id, { title: "Too late" });
    expect(res.status).toBe(409);
    expect(releaseRow(projectId)?.title).toBeNull();
  });

  it("answers 404 for a release of another project", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir);
    const otherId = seedProject(dir);
    const epicId = seedEpic(projectId, "Owned feature");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: false,
    });
    const created = releaseRow(projectId)!;

    const res = await patchRelease(otherId, created.id, { title: "Hijack" });
    expect(res.status).toBe(404);
  });

  it("rejects an empty body", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Empty patch");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: false,
    });
    const created = releaseRow(projectId)!;

    const res = await patchRelease(projectId, created.id, {});
    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
/* Review corrections — the release always gets finalised              */
/* ------------------------------------------------------------------ */
describe("a claimed release is always finalised", () => {
  it("tags the release on the fallback when its run is cancelled while still queued", async () => {
    const { dir, git } = await createTempRepo();
    const projectId = seedProject(dir, "owner/repo");
    const epicId = seedEpic(projectId, "Queued feature");
    const freeSlot = await occupyTheOnlySlot(projectId);

    try {
      await postRelease(projectId, {
        version: "0.9.0",
        epicIds: [epicId],
        generateChangelog: true,
        pushToGitHub: true,
      });
      const [session] = sessionRows(projectId);
      expect(session.status).toBe("queued");
      expect(mockProcessStart).not.toHaveBeenCalled();

      // The user cancels the waiting run: the scheduler drops its closure, so
      // the dispatcher's `settled` never resolves.
      const cancelled = await cancelSession(projectId, session.id);
      expect(cancelled.status).toBe(200);

      // The next read of the page reconciles the orphan.
      const [row] = await getReleases(projectId);
      expect(row.changelogPending).toBe(true);

      await vi.waitFor(() => expect(releaseRow(projectId)?.gitTag).toBe("v0.9.0"));
      expect(await git.raw(["show", "v0.9.0:CHANGELOG.md"])).toContain(
        "- Queued feature"
      );
      // The push-to-GitHub choice survived the lost closure.
      expect(mockCreateDraftRelease).toHaveBeenCalledTimes(1);
      expect(mockWebhook).toHaveBeenCalledTimes(1);
      await vi.waitFor(async () => {
        const [done] = await getReleases(projectId);
        expect(done.changelogPending).toBe(false);
      });
    } finally {
      freeSlot();
    }
  });

  it("finalises a release whose run was reaped by a restart, exactly once", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Reaped feature");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
    });
    const [session] = sessionRows(projectId);

    // What the boot sweep leaves behind: a terminal row whose in-memory run
    // is gone.
    testDb
      .update(schema.agentSessions)
      .set({ status: "failed", error: "orphaned by restart" })
      .where(eq(schema.agentSessions.id, session.id))
      .run();

    await getReleases(projectId);
    await vi.waitFor(() => expect(releaseRow(projectId)?.finalizedAt).not.toBeNull());
    expect(releaseRow(projectId)?.gitTag).toBe("v0.9.0");

    // A late settlement of the same run must not tag, commit or announce twice.
    completeRun(session.id, { success: true, result: AGENT_CHANGELOG });
    // A second finalisation would branch, commit and tag in a real repository
    // before calling the webhook: give it ample time to show up.
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(mockWebhook).toHaveBeenCalledTimes(1);
    expect(releaseRow(projectId)?.changelog).toContain("- Reaped feature");
  });

  it("finalises an orphan once even when the page reads it twice in a row", async () => {
    const { dir, git } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Twice-read feature");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
    });
    const [session] = sessionRows(projectId);
    testDb
      .update(schema.agentSessions)
      .set({ status: "cancelled" })
      .where(eq(schema.agentSessions.id, session.id))
      .run();

    // Two loads while the first finalisation is still writing git objects.
    await Promise.all([getReleases(projectId), getReleases(projectId)]);

    await vi.waitFor(() => expect(releaseRow(projectId)?.finalizedAt).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(mockWebhook).toHaveBeenCalledTimes(1);
    expect(releaseRow(projectId)?.finalizeErrors).toBeNull();
    expect(await refNames(git)).toContain("refs/tags/v0.9.0");
  });

  it("keeps the background GitHub failure on the row, not only in a toast", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir, "owner/repo");
    const epicId = seedEpic(projectId, "Failed sync");
    mockCreateDraftRelease.mockRejectedValueOnce(new Error("GitHub is down"));

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
      pushToGitHub: true,
    });
    completeRun(sessionRows(projectId)[0].id, { success: true, result: AGENT_CHANGELOG });
    await vi.waitFor(() => expect(releaseRow(projectId)?.finalizedAt).not.toBeNull());

    const [row] = await getReleases(projectId);
    expect(row.finalizeErrors).toEqual(
      expect.arrayContaining([expect.stringContaining("GitHub is down")])
    );
  });
});

describe("PATCH /releases/:id — no lost update", () => {
  it("answers 409 to an edit based on a changelog the agent has since replaced", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "Raced feature");

    const res = await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
    });
    const releaseId = (await res.json()).data.release.id as string;
    // The form was opened now, seeded with the fallback.
    const seeded = releaseRow(projectId)!.changelog;

    completeRun(sessionRows(projectId)[0].id, { success: true, result: AGENT_CHANGELOG });
    await vi.waitFor(() => expect(releaseRow(projectId)?.finalizedAt).not.toBeNull());

    const stale = await patchRelease(projectId, releaseId, {
      changelog: `${seeded}\n- one more line`,
      expectedChangelog: seeded,
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("release_changed");
    expect(releaseRow(projectId)?.changelog).toContain("- Written by the changelog agent");
  });

  it("refuses an edit while the tag and the GitHub draft are being written", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir, "owner/repo");
    const epicId = seedEpic(projectId, "Finalizing feature");
    const draft = deferred<unknown>();
    mockCreateDraftRelease.mockReturnValueOnce(draft.promise);

    const res = await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: true,
      pushToGitHub: true,
    });
    const releaseId = (await res.json()).data.release.id as string;
    completeRun(sessionRows(projectId)[0].id, { success: true, result: AGENT_CHANGELOG });
    await vi.waitFor(() => expect(mockCreateDraftRelease).toHaveBeenCalled());

    const during = await patchRelease(projectId, releaseId, { title: "Too early" });
    expect(during.status).toBe(409);
    expect((await during.json()).code).toBe("release_finalizing");

    draft.resolve({ id: 77, url: "https://github.com/owner/repo/releases/77" });
    await vi.waitFor(() => expect(releaseRow(projectId)?.finalizedAt).not.toBeNull());
    expect(releaseRow(projectId)?.title).toBeNull();
  });

  it("does not rewrite a GitHub release that is already public", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir, "owner/repo");
    const epicId = seedEpic(projectId, "Public elsewhere");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: false,
      pushToGitHub: true,
    });
    const created = releaseRow(projectId)!;
    mockGetRelease.mockResolvedValue({ id: 77, draft: false });

    const res = await patchRelease(projectId, created.id, { title: "Rewritten" });

    expect(res.status).toBe(409);
    expect(mockUpdateDraftRelease).not.toHaveBeenCalled();
    expect(releaseRow(projectId)?.title).toBeNull();
    expect(releaseRow(projectId)?.publishedAt).toEqual(expect.any(String));
  });
});

describe("POST /releases/:id/publish — healing is announced", () => {
  it("emits release:updated when it records a release already public on GitHub", async () => {
    const { dir } = await createTempRepo();
    const projectId = seedProject(dir, "owner/repo");
    const epicId = seedEpic(projectId, "Healed");

    await postRelease(projectId, {
      version: "0.9.0",
      epicIds: [epicId],
      generateChangelog: false,
      pushToGitHub: true,
    });
    const created = releaseRow(projectId)!;
    mockGetRelease.mockResolvedValue({ id: 77, draft: false });

    const events: TicketEvent[] = [];
    const unsubscribe = eventBus.subscribe(projectId, (event) => events.push(event));
    try {
      const pub = await publish(projectId, created.id);
      expect(pub.status).toBe(409);
    } finally {
      unsubscribe();
    }
    expect(
      events.some((e) => e.type === "release:updated" && e.data.releaseId === created.id)
    ).toBe(true);
  });
});
