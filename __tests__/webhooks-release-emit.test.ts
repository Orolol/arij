import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
  mockRouteContext,
} from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("simple-git", () => ({ default: vi.fn(() => ({})) }));
vi.mock("@/lib/github/releases", () => ({ createDraftRelease: vi.fn() }));
vi.mock("@/lib/github/sync-log", () => ({ logSyncOperation: vi.fn() }));
vi.mock("@/lib/git/release", () => ({
  createReleaseBranchAndCommitChangelog: vi.fn(),
}));
vi.mock("@/lib/claude/process-manager", () => ({
  processManager: { start: vi.fn(), getStatus: vi.fn(() => undefined) },
}));
vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgentByNamedId: vi.fn(() => ({
    provider: "claude-code",
    name: null,
    namedAgentId: null,
    model: null,
  })),
}));
vi.mock("@/lib/workflow/transition-service", () => ({
  applyTransition: vi.fn(() => ({ valid: true })),
}));
vi.mock("@/lib/events/emit", () => ({ emitReleaseCreated: vi.fn() }));
vi.mock("@/lib/utils/nanoid", () => ({ createId: vi.fn(() => "rel-1") }));
vi.mock("@/lib/webhooks/send", () => ({
  sendProjectWebhook: vi.fn(() => Promise.resolve()),
}));

import { POST } from "@/app/api/projects/[projectId]/releases/route";
import { sendProjectWebhook } from "@/lib/webhooks/send";

const sendMock = vi.mocked(sendProjectWebhook);

/**
 * Drives the shortest successful path: no changelog generation, no git repo,
 * so the route goes straight from validation to insert + emit.
 */
function seedRelease() {
  // getProjectOr404 -> project without gitRepoPath (skips git/GitHub work)
  dbMockState.getQueue.push({ id: "p1", name: "Arij", gitRepoPath: null });
  // selected epics (must all be "done" to pass pre-validation)
  dbMockState.allQueue.push([
    { id: "e1", title: "Login", status: "done", type: "feature" },
  ]);
  // final re-read of the inserted release row
  dbMockState.getQueue.push({ id: "rel-1", version: "1.2.0" });
}

describe("POST /releases webhook emit point", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("fires release.created with the version label and releases deep link", async () => {
    seedRelease();

    const res = await POST(
      mockJsonRequest({
        version: "1.2.0",
        epicIds: ["e1"],
        generateChangelog: false,
      }),
      mockRouteContext({ projectId: "p1" })
    );

    expect(res.status).toBe(201);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith("p1", {
      event: "release.created",
      ticketTitle: "v1.2.0",
      path: "/projects/p1/releases",
    });
  });

  it("includes the release title in the label when provided", async () => {
    seedRelease();

    await POST(
      mockJsonRequest({
        version: "1.2.0",
        title: "Summer drop",
        epicIds: ["e1"],
        generateChangelog: false,
      }),
      mockRouteContext({ projectId: "p1" })
    );

    expect(sendMock).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ ticketTitle: "v1.2.0 — Summer drop" })
    );
  });

  it("does not fire when the release is rejected", async () => {
    dbMockState.getQueue.push({ id: "p1", name: "Arij", gitRepoPath: null });
    dbMockState.allQueue.push([
      { id: "e1", title: "Login", status: "in_progress", type: "feature" },
    ]);

    const res = await POST(
      mockJsonRequest({
        version: "1.2.0",
        epicIds: ["e1"],
        generateChangelog: false,
      }),
      mockRouteContext({ projectId: "p1" })
    );

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
