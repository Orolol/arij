/**
 * B-arij-239 — a rejected release must leave the repository untouched.
 *
 * The release route used to create the release branch, commit CHANGELOG.md,
 * tag the commit and (when asked) push to GitHub *before* it checked that
 * every included epic was actually "done". A request rejected with HTTP 400
 * therefore left `refs/heads/release/v<version>` and `refs/tags/v<version>`
 * behind, pointing at a changelog commit no release row referenced.
 *
 * These tests drive the real route handler against a real migrated SQLite
 * database and a real temporary Git repository, so the refs they assert on
 * are the repository's own, not a mock's call log.
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

/* ------------------------------------------------------------------ */
/* Real database, real schema                                          */
/* ------------------------------------------------------------------ */
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const testSqlite = new Database(path.join(tempDir("arij-release-db-"), "arij.db"));
initDb(testSqlite);
const testDb = drizzle(testSqlite, { schema });

vi.mock("@/lib/db", () => ({ db: testDb, sqlite: testSqlite }));

/* ------------------------------------------------------------------ */
/* Stub only what would reach outside the process                      */
/* ------------------------------------------------------------------ */
const mockProcessStart = vi.hoisted(() => vi.fn());
vi.mock("@/lib/claude/process-manager", () => ({
  processManager: { start: mockProcessStart, getStatus: vi.fn(() => null) },
}));
vi.mock("@/lib/agent-sessions/wait-for-completion", () => ({
  waitForProcessCompletion: vi.fn(async () => null),
}));

const mockCreateDraftRelease = vi.hoisted(() => vi.fn());
const mockLogSyncOperation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/github/sync-log", () => ({ logSyncOperation: mockLogSyncOperation }));
vi.mock("@/lib/github/releases", () => ({
  createDraftRelease: mockCreateDraftRelease,
  publishRelease: vi.fn(),
}));
vi.mock("@/lib/webhooks/send", () => ({ sendProjectWebhook: vi.fn() }));
vi.mock("@/lib/workflow/spec-auto-rewrite", () => ({
  maybeAutoRewriteSpecAfterRelease: vi.fn(),
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
  const dir = tempDir("arij-release-repo-");
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

/** Every ref in the repository, as `<sha> <refname>` lines — the repro's `git show-ref`. */
async function showRef(git: SimpleGit): Promise<string[]> {
  const raw = await git.raw(["show-ref"]).catch(() => "");
  return raw.split("\n").filter(Boolean).sort();
}

let projectSeq = 0;

function seedProject(gitRepoPath: string, githubOwnerRepo?: string): string {
  const id = `proj_${++projectSeq}`;
  testDb
    .insert(schema.projects)
    .values({
      id,
      name: `Release Test ${id}`,
      gitRepoPath,
      defaultBranch: "main",
      githubOwnerRepo: githubOwnerRepo ?? null,
    })
    .run();
  return id;
}

function seedEpic(projectId: string, status: string, title: string): string {
  const id = `ep_${projectId}_${status}_${Math.random().toString(36).slice(2, 8)}`;
  testDb
    .insert(schema.epics)
    .values({ id, projectId, title, description: "desc", status })
    .run();
  return id;
}

function releaseRoute() {
  return import("@/app/api/projects/[projectId]/releases/route");
}

function releaseRequest(projectId: string, body: Record<string, unknown>) {
  return mockNextRequest({
    url: `http://localhost/api/projects/${projectId}/releases`,
    method: "POST",
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  // The unfixed route spawns a release-notes session before validating; clean
  // up any scratch session directory it left in data/sessions/.
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
/* Tests                                                               */
/* ------------------------------------------------------------------ */
describe("POST /api/projects/:id/releases — rejected requests are side-effect free", () => {
  it("leaves refs, CHANGELOG.md and release rows untouched when an epic is not done", async () => {
    const { dir, git } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "backlog", "Unfinished epic");

    const refsBefore = await showRef(git);
    const headBefore = await git.revparse(["HEAD"]);

    const { POST } = await releaseRoute();
    const res = await POST(
      releaseRequest(projectId, {
        version: "0.0.91",
        epicIds: [epicId],
        generateChangelog: false,
        pushToGitHub: false,
      }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("done");

    // The repository must look exactly as it did before the request.
    expect(await showRef(git)).toEqual(refsBefore);
    const refNames = refsBefore.map((line) => line.split(" ")[1]);
    expect(refNames).not.toContain("refs/heads/release/v0.0.91");
    expect(refNames).not.toContain("refs/tags/v0.0.91");
    expect(await git.revparse(["HEAD"])).toBe(headBefore);
    expect(fs.existsSync(path.join(dir, "CHANGELOG.md"))).toBe(false);

    // And no release row, no epic transition.
    const rows = testDb.select().from(schema.releases).all();
    expect(rows.filter((r) => r.projectId === projectId)).toHaveLength(0);
    const epic = testDb
      .select()
      .from(schema.epics)
      .where(eq(schema.epics.id, epicId))
      .get();
    expect(epic?.status).toBe("backlog");
    expect(epic?.releaseId).toBeNull();
  });

  it("does not spawn the changelog agent for a request it is going to reject", async () => {
    const { dir, git } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "in_progress", "Still building");

    const refsBefore = await showRef(git);

    const { POST } = await releaseRoute();
    const res = await POST(
      releaseRequest(projectId, {
        version: "0.0.92",
        epicIds: [epicId],
        generateChangelog: true,
        pushToGitHub: false,
      }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(400);
    expect(mockProcessStart).not.toHaveBeenCalled();
    expect(
      testDb.select().from(schema.agentSessions).all().filter((s) => s.projectId === projectId)
    ).toHaveLength(0);
    expect(await showRef(git)).toEqual(refsBefore);
  });

  it("rejects epic ids that do not belong to the project without touching the repo", async () => {
    const { dir, git } = await createTempRepo();
    const projectId = seedProject(dir);
    const otherRepo = await createTempRepo();
    const otherProjectId = seedProject(otherRepo.dir);
    const foreignEpicId = seedEpic(otherProjectId, "done", "Someone else's epic");

    const refsBefore = await showRef(git);

    const { POST } = await releaseRoute();
    const res = await POST(
      releaseRequest(projectId, {
        version: "0.0.93",
        epicIds: [foreignEpicId, "ep_does_not_exist"],
        generateChangelog: false,
        pushToGitHub: false,
      }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(400);
    expect(await showRef(git)).toEqual(refsBefore);
    expect(fs.existsSync(path.join(dir, "CHANGELOG.md"))).toBe(false);
    expect(
      testDb.select().from(schema.releases).all().filter((r) => r.projectId === projectId)
    ).toHaveLength(0);
  });

  it("publishes nothing to GitHub for a request it is going to reject", async () => {
    // The original report could only infer this half from source ordering:
    // the tag push and the draft release ran before the status check, so a
    // rejected release of an unfinished ticket was one `pushToGitHub` away
    // from publishing a tag and a draft nobody asked for.
    const { dir, git } = await createTempRepo();
    const projectId = seedProject(dir, "owner/repo");
    const epicId = seedEpic(projectId, "review", "Awaiting review");

    const refsBefore = await showRef(git);

    const { POST } = await releaseRoute();
    const res = await POST(
      releaseRequest(projectId, {
        version: "0.0.95",
        epicIds: [epicId],
        generateChangelog: false,
        pushToGitHub: true,
      }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(400);
    expect(mockCreateDraftRelease).not.toHaveBeenCalled();
    expect(mockLogSyncOperation).not.toHaveBeenCalled();
    expect(await showRef(git)).toEqual(refsBefore);
  });

  it("still creates the branch, the tag and the release row for a valid request", async () => {
    const { dir, git } = await createTempRepo();
    const projectId = seedProject(dir);
    const epicId = seedEpic(projectId, "done", "Finished epic");

    const { POST } = await releaseRoute();
    const res = await POST(
      releaseRequest(projectId, {
        version: "0.0.94",
        epicIds: [epicId],
        generateChangelog: false,
        pushToGitHub: false,
      }),
      mockRouteContext({ projectId })
    );

    expect(res.status).toBe(201);

    const refNames = (await showRef(git)).map((line) => line.split(" ")[1]);
    expect(refNames).toContain("refs/heads/release/v0.0.94");
    expect(refNames).toContain("refs/tags/v0.0.94");

    const row = testDb
      .select()
      .from(schema.releases)
      .all()
      .find((r) => r.projectId === projectId);
    expect(row?.version).toBe("0.0.94");
    expect(row?.releaseBranch).toBe("release/v0.0.94");
    expect(row?.gitTag).toBe("v0.0.94");
  });
});
