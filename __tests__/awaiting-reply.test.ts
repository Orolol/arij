/**
 * "Awaiting reply" derivation for kanban cards: latest session ended with
 * asked_question AND no newer user comment.
 */
import { describe, expect, it } from "vitest";
import { isAwaitingReply } from "@/lib/kanban/awaiting-reply";

describe("isAwaitingReply", () => {
  it("is false when there is no session signal at all", () => {
    expect(isAwaitingReply({})).toBe(false);
    expect(
      isAwaitingReply({
        latestSessionOutcome: null,
        latestSessionEndedAt: null,
        latestUserCommentCreatedAt: null,
      })
    ).toBe(false);
  });

  it("is false for non-question verdicts", () => {
    for (const outcome of ["answered", "silent", "error"]) {
      expect(
        isAwaitingReply({
          latestSessionOutcome: outcome,
          latestSessionEndedAt: "2026-08-16T09:05:00.000Z",
        })
      ).toBe(false);
    }
  });

  it("is true when the agent asked and the user never commented", () => {
    expect(
      isAwaitingReply({
        latestSessionOutcome: "asked_question",
        latestSessionEndedAt: "2026-08-16T09:05:00.000Z",
        latestUserCommentCreatedAt: null,
      })
    ).toBe(true);
  });

  it("is true when the only user comment predates the question", () => {
    expect(
      isAwaitingReply({
        latestSessionOutcome: "asked_question",
        latestSessionEndedAt: "2026-08-16T09:05:00.000Z",
        latestUserCommentCreatedAt: "2026-08-16T08:00:00.000Z",
      })
    ).toBe(true);
  });

  it("is false once the user replies after the question", () => {
    expect(
      isAwaitingReply({
        latestSessionOutcome: "asked_question",
        latestSessionEndedAt: "2026-08-16T09:05:00.000Z",
        latestUserCommentCreatedAt: "2026-08-16T09:10:00.000Z",
      })
    ).toBe(false);
  });

  it("orders SQLite CURRENT_TIMESTAMP against ISO timestamps correctly", () => {
    // Session end written by routes (ISO), comment written with the SQLite
    // default format (space separator, UTC): the reply is later.
    expect(
      isAwaitingReply({
        latestSessionOutcome: "asked_question",
        latestSessionEndedAt: "2026-08-16T09:05:00.000Z",
        latestUserCommentCreatedAt: "2026-08-16 09:30:00",
      })
    ).toBe(false);

    // And the reverse: SQLite-format comment older than the ISO session end.
    expect(
      isAwaitingReply({
        latestSessionOutcome: "asked_question",
        latestSessionEndedAt: "2026-08-16T09:05:00.000Z",
        latestUserCommentCreatedAt: "2026-08-16 08:30:00",
      })
    ).toBe(true);
  });

  it("assumes answered when the question time is unknown but a reply exists", () => {
    expect(
      isAwaitingReply({
        latestSessionOutcome: "asked_question",
        latestSessionEndedAt: null,
        latestUserCommentCreatedAt: "2026-08-16T09:10:00.000Z",
      })
    ).toBe(false);
  });
});
