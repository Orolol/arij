/**
 * Buildable-status guard on the dependency closure
 * (lib/dependencies/validation.ts), against the real migrated schema.
 *
 * A done/released prerequisite is SATISFIED: it must not be auto-included by
 * the batch selection, must not be re-planned into a wave, and must not hold
 * its dependents back. Combined with buildExecutionPlan, a dependent whose
 * only prerequisites are done therefore lands in wave 1.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createTestDb } = await import("@/lib/db/test-utils");
  const created = createTestDb();
  return { db: created.db, sqlite: created.sqlite, ensureDbReady: vi.fn() };
});

const { db } = await import("@/lib/db");
const { projects, epics, ticketDependencies } = await import("@/lib/db/schema");
const { filterBuildableTickets, getTransitiveDependencies } = await import(
  "@/lib/dependencies/validation"
);
const { buildExecutionPlan } = await import("@/lib/dependencies/scheduler");

const PROJECT_ID = "proj-buildable";

function seedEpic(id: string, status: string) {
  db.insert(epics)
    .values({ id, projectId: PROJECT_ID, title: id, status })
    .run();
}

/** `ticket` depends on `dependsOn`. */
function seedEdge(ticket: string, dependsOn: string) {
  db.insert(ticketDependencies)
    .values({
      id: `dep-${ticket}-${dependsOn}`,
      ticketId: ticket,
      dependsOnTicketId: dependsOn,
      projectId: PROJECT_ID,
      scopeType: "project",
      scopeId: PROJECT_ID,
    })
    .run();
}

beforeEach(() => {
  db.delete(ticketDependencies).run();
  db.delete(epics).run();
  db.delete(projects).run();
  db.insert(projects)
    .values({ id: PROJECT_ID, name: "Buildable", gitRepoPath: "/repos/b" })
    .run();
});

describe("getTransitiveDependencies — satisfied prerequisites", () => {
  it("auto-includes a buildable prerequisite", () => {
    seedEpic("todo-dep", "todo");
    seedEpic("target", "backlog");
    seedEdge("target", "todo-dep");

    expect(getTransitiveDependencies(PROJECT_ID, ["target"])).toEqual(
      new Set(["target", "todo-dep"])
    );
  });

  it.each(["done", "released"])(
    "excludes a %s prerequisite from the closure",
    (status) => {
      seedEpic("delivered", status);
      seedEpic("target", "todo");
      seedEdge("target", "delivered");

      expect(getTransitiveDependencies(PROJECT_ID, ["target"])).toEqual(
        new Set(["target"])
      );
    }
  );

  it("does not expand through a done prerequisite", () => {
    // target -> doneDep -> deepBacklog. doneDep is delivered, so whatever it
    // depended on is transitively delivered too: nothing to pull in.
    seedEpic("deep-backlog", "backlog");
    seedEpic("done-dep", "done");
    seedEpic("target", "todo");
    seedEdge("done-dep", "deep-backlog");
    seedEdge("target", "done-dep");

    expect(getTransitiveDependencies(PROJECT_ID, ["target"])).toEqual(
      new Set(["target"])
    );
  });

  it("keeps an explicitly selected done ticket as a seed", () => {
    // The selection is the user's; it is the build route that refuses to
    // dispatch a non-buildable ticket (see filterBuildableTickets).
    seedEpic("delivered", "done");

    expect(getTransitiveDependencies(PROJECT_ID, ["delivered"])).toEqual(
      new Set(["delivered"])
    );
  });

  it("still includes buildable prerequisites reached around a done one", () => {
    seedEpic("done-dep", "done");
    seedEpic("todo-dep", "todo");
    seedEpic("target", "backlog");
    seedEdge("target", "done-dep");
    seedEdge("target", "todo-dep");

    expect(getTransitiveDependencies(PROJECT_ID, ["target"])).toEqual(
      new Set(["target", "todo-dep"])
    );
  });
});

describe("filterBuildableTickets", () => {
  it("keeps buildable statuses and drops delivered ones, preserving order", () => {
    seedEpic("a-backlog", "backlog");
    seedEpic("b-done", "done");
    seedEpic("c-todo", "todo");
    seedEpic("d-released", "released");
    seedEpic("e-in-progress", "in_progress");
    seedEpic("f-review", "review");

    expect(
      filterBuildableTickets(PROJECT_ID, [
        "a-backlog",
        "b-done",
        "c-todo",
        "d-released",
        "e-in-progress",
        "f-review",
      ])
    ).toEqual(["a-backlog", "c-todo", "e-in-progress", "f-review"]);
  });

  it("drops ids with no epic row and short-circuits on an empty input", () => {
    seedEpic("real", "todo");

    expect(filterBuildableTickets(PROJECT_ID, ["real", "ghost"])).toEqual([
      "real",
    ]);
    expect(filterBuildableTickets(PROJECT_ID, [])).toEqual([]);
  });
});

describe("wave planning over the guarded closure", () => {
  it("puts a dependent whose only prerequisites are done in wave 1", () => {
    seedEpic("done-dep", "done");
    seedEpic("dependent", "todo");
    seedEdge("dependent", "done-dep");

    const closure = Array.from(
      getTransitiveDependencies(PROJECT_ID, ["dependent"])
    );
    const buildable = filterBuildableTickets(PROJECT_ID, closure);
    const plan = buildExecutionPlan(PROJECT_ID, buildable);

    expect(buildable).toEqual(["dependent"]);
    expect(plan.layers).toEqual([["dependent"]]);
  });

  it("does not re-plan a done epic the caller named explicitly", () => {
    seedEpic("done-dep", "done");
    seedEpic("dependent", "todo");
    seedEdge("dependent", "done-dep");

    const buildable = filterBuildableTickets(PROJECT_ID, [
      "done-dep",
      "dependent",
    ]);
    const plan = buildExecutionPlan(PROJECT_ID, buildable);

    expect(buildable).toEqual(["dependent"]);
    expect(plan.layers).toEqual([["dependent"]]);
    expect(plan.ticketStatus.has("done-dep")).toBe(false);
  });
});
