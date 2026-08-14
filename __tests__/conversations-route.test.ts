import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
} from "@/__tests__/helpers/db-mock";

const { runCutoverMigrationOnce } = vi.hoisted(() => ({
  runCutoverMigrationOnce: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "conv-created"),
}));

vi.mock("@/lib/agent-config/agent-resolution", () => ({
  resolveAgent: vi.fn(() => ({
    provider: "claude-code",
    namedAgentId: null,
  })),
}));

vi.mock("@/lib/chat/unified-cutover-migration", () => ({
  runUnifiedChatCutoverMigrationOnce: runCutoverMigrationOnce,
}));

describe("conversations route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("runs cutover migration and normalizes legacy type/status order", async () => {
    // GET first checks the project exists via .get()
    dbMockState.getQueue.push({ id: "proj-1" });
    // …then loads the project's conversations via .all()
    dbMockState.allQueue.push([
      {
        id: "conv-newer",
        projectId: "proj-1",
        type: "brainstorm",
        label: "Brainstorm",
        status: "mystery",
        epicId: null,
        provider: "claude-code",
        createdAt: "2026-02-12T12:00:00.000Z",
      },
      {
        id: "conv-older",
        projectId: "proj-1",
        type: "epic",
        label: "Legacy Epic",
        status: "generating",
        epicId: null,
        provider: "claude-code",
        createdAt: "2026-02-12T11:00:00.000Z",
      },
    ]);

    const { GET } = await import("@/app/api/projects/[projectId]/conversations/route");

    const response = await GET({} as never, {
      params: Promise.resolve({ projectId: "proj-1" }),
    });
    const json = await response.json();

    expect(runCutoverMigrationOnce).toHaveBeenCalledWith("proj-1");
    expect(json.data).toHaveLength(2);
    expect(json.data[0]).toMatchObject({
      id: "conv-older",
      type: "epic_creation",
      status: "generating",
    });
    expect(json.data[1]).toMatchObject({
      id: "conv-newer",
      status: "active",
    });
  });
});
