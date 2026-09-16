/**
 * Workflow effects for the asked_question delivery verdict:
 * `handleAskedQuestionOutcome` must log a held from==to activity entry with
 * actor "system" per held epic — without ever throwing into the caller's
 * background completion block.
 *
 * The user-facing signal is not created here: the desk's "Your turn" stratum
 * derives the ask from the session's `asked_question` outcome, and the
 * `session.completed` webhook fires from the terminal hook like every other
 * completed session.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/utils/nanoid", () => ({
  createId: vi.fn(() => "generated-id"),
}));

const { handleAskedQuestionOutcome, AGENT_ASKED_QUESTION_REASON } =
  await import("@/lib/workflow/agent-question");

beforeEach(() => {
  resetDbMockState();
  vi.clearAllMocks();
});

describe("handleAskedQuestionOutcome", () => {
  it("logs a system activity entry holding the ticket", () => {
    handleAskedQuestionOutcome({
      projectId: "proj-1",
      epicIds: ["epic-1"],
      sessionId: "sess-1",
      ticketStatus: "in_progress",
    });

    expect(dbMockState.insertCalls).toHaveLength(1);

    const activity = dbMockState.insertCalls[0] as Record<string, unknown>;
    expect(activity).toMatchObject({
      projectId: "proj-1",
      epicId: "epic-1",
      fromStatus: "in_progress",
      toStatus: "in_progress",
      actor: "system",
      reason: AGENT_ASKED_QUESTION_REASON,
      sessionId: "sess-1",
    });
  });

  it("logs one entry per held epic, ignoring nullish entries (team builds)", () => {
    handleAskedQuestionOutcome({
      projectId: "proj-1",
      epicIds: ["epic-1", "epic-2", null],
      sessionId: "sess-1",
      ticketStatus: "in_progress",
    });

    expect(
      dbMockState.insertCalls.map((call) => (call as Record<string, unknown>).epicId),
    ).toEqual(["epic-1", "epic-2"]);
  });

  it("logs each held epic with its own status (team builds straddling columns)", () => {
    // A team session coordinates several epics; their pullbacks can land in
    // different columns (one returned to in_progress, one whose guarded
    // pullback was refused). A single shared status would stamp a false
    // hold entry on every feed but the first.
    handleAskedQuestionOutcome({
      projectId: "proj-1",
      epicIds: ["epic-1", "epic-2", "epic-3"],
      sessionId: "sess-1",
      ticketStatus: "in_progress",
      ticketStatusByEpicId: { "epic-1": "in_progress", "epic-2": "review" },
    });

    const activity = dbMockState.insertCalls.map(
      (call) => call as Record<string, unknown>,
    );
    expect(
      activity.map((entry) => [entry.epicId, entry.fromStatus, entry.toStatus]),
    ).toEqual([
      ["epic-1", "in_progress", "in_progress"],
      ["epic-2", "review", "review"],
      // epic-3 is absent from the map: falls back to ticketStatus.
      ["epic-3", "in_progress", "in_progress"],
    ]);
  });

  it("defaults the held status to in_progress", () => {
    handleAskedQuestionOutcome({
      projectId: "proj-1",
      epicIds: ["epic-1"],
      sessionId: "sess-1",
    });

    const activity = dbMockState.insertCalls[0] as Record<string, unknown>;
    expect(activity.fromStatus).toBe("in_progress");
    expect(activity.toStatus).toBe("in_progress");
  });

  it("still logs the activity entries when the session row is gone", () => {
    handleAskedQuestionOutcome({
      projectId: "proj-1",
      epicIds: ["epic-1"],
      sessionId: "sess-gone",
      ticketStatus: "review",
    });

    expect(dbMockState.insertCalls).toHaveLength(1);
    expect(dbMockState.insertCalls[0]).toMatchObject({
      actor: "system",
      reason: AGENT_ASKED_QUESTION_REASON,
      fromStatus: "review",
      toStatus: "review",
    });
  });
});
