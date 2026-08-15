import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

const { mockValidateSameProject, mockValidateDagIntegrity } = vi.hoisted(() => ({
  mockValidateSameProject: vi.fn(),
  mockValidateDagIntegrity: vi.fn(),
}));

const mockIdState = vi.hoisted(() => ({ value: 1 }));

// Real drizzle-orm + real @/lib/db/schema: both are side-effect-free pure
// builders, and the chain mock ignores their output. No fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => {
    const id = `dep-${mockIdState.value}`;
    mockIdState.value += 1;
    return id;
  }),
}));

vi.mock("@/lib/dependencies/validation", () => ({
  validateSameProject: mockValidateSameProject,
  validateDagIntegrity: mockValidateDagIntegrity,
}));

describe("dependencies CRUD batching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    mockIdState.value = 1;
  });

  it("inserts only missing edges in a single batch insert", async () => {
    dbMockState.allQueue = [
      [{ ticketId: "epic-1", dependsOnTicketId: "epic-2" }],
    ];

    const { createDependencies } = await import("@/lib/dependencies/crud");
    const created = createDependencies("proj-1", [
      { ticketId: "epic-1", dependsOnTicketId: "epic-2" },
      { ticketId: "epic-3", dependsOnTicketId: "epic-4" },
    ]);

    expect(created).toHaveLength(1);
    expect(created[0]).toEqual(
      expect.objectContaining({
        id: "dep-1",
        ticketId: "epic-3",
        dependsOnTicketId: "epic-4",
        projectId: "proj-1",
      }),
    );
    expect(dbMockState.insertCalls).toHaveLength(1);
    expect((dbMockState.insertCalls[0] as Array<Record<string, unknown>>)).toHaveLength(1);
    expect(mockValidateSameProject).toHaveBeenCalledWith("proj-1", [
      { ticketId: "epic-1", dependsOnTicketId: "epic-2" },
      { ticketId: "epic-3", dependsOnTicketId: "epic-4" },
    ]);
    expect(mockValidateDagIntegrity).toHaveBeenCalledWith("proj-1", [
      { ticketId: "epic-1", dependsOnTicketId: "epic-2" },
      { ticketId: "epic-3", dependsOnTicketId: "epic-4" },
    ]);
  });

  it("drops self-dependencies and duplicate edges before insert", async () => {
    dbMockState.allQueue = [[]];

    const { createDependencies } = await import("@/lib/dependencies/crud");
    const created = createDependencies("proj-1", [
      { ticketId: "epic-1", dependsOnTicketId: "epic-1" },
      { ticketId: "epic-2", dependsOnTicketId: "epic-3" },
      { ticketId: "epic-2", dependsOnTicketId: "epic-3" },
    ]);

    expect(created).toHaveLength(1);
    expect(dbMockState.insertCalls).toHaveLength(1);
    expect((dbMockState.insertCalls[0] as Array<Record<string, unknown>>)).toHaveLength(1);
    expect(mockValidateSameProject).toHaveBeenCalledWith("proj-1", [
      { ticketId: "epic-2", dependsOnTicketId: "epic-3" },
      { ticketId: "epic-2", dependsOnTicketId: "epic-3" },
    ]);
  });

  it("skips insert when all candidate edges already exist", async () => {
    dbMockState.allQueue = [[{ ticketId: "epic-2", dependsOnTicketId: "epic-3" }]];

    const { createDependencies } = await import("@/lib/dependencies/crud");
    const created = createDependencies("proj-1", [
      { ticketId: "epic-2", dependsOnTicketId: "epic-3" },
    ]);

    expect(created).toEqual([]);
    expect(dbMockState.insertCalls).toHaveLength(0);
  });
});
