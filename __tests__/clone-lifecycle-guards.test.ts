import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  dbMockState,
  resetDbMockState,
} from "@/__tests__/helpers/db-mock";

/**
 * The two mechanisms the deletion story leans on: the projects-root
 * containment guard (which decides whether a directory may be touched at all)
 * and cancelling a project's live agents before it goes away.
 */

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

const mockSchedulerRemove = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/scheduler", () => ({
  agentScheduler: { remove: mockSchedulerRemove },
}));

const mockProcessCancel = vi.hoisted(() => vi.fn());
vi.mock("@/lib/claude/process-manager", () => ({
  processManager: { cancel: mockProcessCancel },
}));

const mockMarkSessionCancelled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agent-sessions/lifecycle", () => ({
  markSessionCancelled: mockMarkSessionCancelled,
}));

const mockListByProject = vi.hoisted(() => vi.fn());
const mockActivityCancel = vi.hoisted(() => vi.fn());
vi.mock("@/lib/activity-registry", () => ({
  activityRegistry: {
    listByProject: mockListByProject,
    cancel: mockActivityCancel,
  },
}));

import { cancelProjectSessions } from "@/lib/projects/cancel-sessions";
import {
  defaultProjectsRoot,
  isInsideProjectsRoot,
  resolveCloneDestination,
  resolveProjectsRoot,
} from "@/lib/projects/workspace";
import { parseProjectsRootSetting } from "@/lib/projects/workspace-constants";

const ROOT = "/home/me/arij/projects";

beforeEach(() => {
  vi.clearAllMocks();
  resetDbMockState();
  mockListByProject.mockReturnValue([]);
  mockActivityCancel.mockReturnValue(true);
});

describe("isInsideProjectsRoot", () => {
  it.each([
    [`${ROOT}/owner-repo`, true],
    [`${ROOT}/.arij-worktrees/feature-x`, true],
    [`${ROOT}/a/b/c`, true],
    [ROOT, false],
    [`${ROOT}/`, false],
    [`${ROOT}-backup/owner-repo`, false],
    ["/home/me/code/my-repo", false],
    ["/", false],
    [`${ROOT}/../../etc`, false],
  ])("%s -> %s", (candidate, expected) => {
    expect(isInsideProjectsRoot(candidate, ROOT)).toBe(expected);
  });
});

describe("resolveCloneDestination", () => {
  it("builds <root>/<owner>-<repo>", () => {
    expect(resolveCloneDestination("owner", "repo", ROOT)).toBe(
      path.join(ROOT, "owner-repo")
    );
  });

  it("is deterministic, so re-importing the same URL takes the reuse path", () => {
    expect(resolveCloneDestination("owner", "repo", ROOT)).toBe(
      resolveCloneDestination("owner", "repo", ROOT)
    );
  });

  it("keeps same-named repositories of different owners apart", () => {
    expect(resolveCloneDestination("alice", "app", ROOT)).not.toBe(
      resolveCloneDestination("bob", "app", ROOT)
    );
  });

  it.each([
    ["..", "repo"],
    ["owner", ".."],
    [".", "repo"],
    ["owner/../..", "repo"],
    ["owner", "repo/../../etc"],
    ["", "repo"],
  ])("rejects unsafe segments (%s/%s)", (owner, repo) => {
    expect(() => resolveCloneDestination(owner, repo, ROOT)).toThrow(
      /unsafe repository identifier|escapes/i
    );
  });
});

describe("parseProjectsRootSetting", () => {
  it.each([
    [JSON.stringify("/srv/clones"), "/srv/clones"],
    ["/srv/clones", "/srv/clones"],
    [JSON.stringify("  /srv/clones  "), "/srv/clones"],
    // Relative roots would move with the server's cwd — refuse them.
    [JSON.stringify("relative/path"), null],
    [JSON.stringify(""), null],
    [JSON.stringify(42), null],
    [undefined, null],
    [null, null],
  ])("%s -> %s", (raw, expected) => {
    expect(parseProjectsRootSetting(raw)).toBe(expected);
  });
});

describe("resolveProjectsRoot", () => {
  it("defaults to <cwd>/projects when unset", () => {
    dbMockState.getQueue = [undefined];

    expect(resolveProjectsRoot()).toBe(defaultProjectsRoot());
  });

  it("uses the configured root", () => {
    dbMockState.getQueue = [{ value: JSON.stringify("/srv/clones") }];

    expect(resolveProjectsRoot()).toBe("/srv/clones");
  });

  it("falls back to the default for a malformed value", () => {
    dbMockState.getQueue = [{ value: JSON.stringify("not/absolute") }];

    expect(resolveProjectsRoot()).toBe(defaultProjectsRoot());
  });
});

describe("cancelProjectSessions", () => {
  it("cancels every queued and running session", () => {
    dbMockState.allQueue = [[{ id: "sess-1" }, { id: "sess-2" }]];

    const result = cancelProjectSessions("proj-1", "Project deleted");

    expect(result.sessions).toEqual(["sess-1", "sess-2"]);
    // Queue slot first, then the live process — same order as the session
    // DELETE route, so a not-yet-started launch cannot slip through.
    expect(mockSchedulerRemove).toHaveBeenCalledWith("sess-1");
    expect(mockProcessCancel).toHaveBeenCalledWith("sess-1");
    expect(mockMarkSessionCancelled).toHaveBeenCalledWith(
      "sess-1",
      "Project deleted",
      expect.any(String)
    );
  });

  it("keeps going when one session refuses to cancel", () => {
    dbMockState.allQueue = [[{ id: "sess-1" }, { id: "sess-2" }]];
    mockMarkSessionCancelled.mockImplementationOnce(() => {
      throw new Error("INVALID_SESSION_TRANSITION");
    });

    const result = cancelProjectSessions("proj-1");

    expect(result.sessions).toEqual(["sess-2"]);
    expect(mockProcessCancel).toHaveBeenCalledTimes(2);
  });

  it("cancels ephemeral activities too", () => {
    dbMockState.allQueue = [[]];
    mockListByProject.mockReturnValue([
      { id: "act-1", projectId: "proj-1" },
      { id: "act-2", projectId: "proj-1" },
    ]);

    const result = cancelProjectSessions("proj-1");

    expect(result.activities).toEqual(["act-1", "act-2"]);
  });

  it("does nothing for a project with no live work", () => {
    dbMockState.allQueue = [[]];

    expect(cancelProjectSessions("proj-1")).toEqual({
      sessions: [],
      activities: [],
    });
    expect(mockProcessCancel).not.toHaveBeenCalled();
  });
});
