import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database and validation module
const mockGraph = new Map<string, Set<string>>();

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

vi.mock("@/lib/dependencies/validation", () => ({
  topologicalSort: vi.fn((_projectId: string, ticketIds: string[]) => {
    // Compute topological layers from mockGraph
    const ticketSet = new Set(ticketIds);
    const inDegree = new Map<string, number>();
    const successors = new Map<string, Set<string>>();

    for (const id of ticketSet) {
      inDegree.set(id, 0);
      successors.set(id, new Set());
    }

    for (const id of ticketSet) {
      const deps = mockGraph.get(id);
      if (!deps) continue;
      for (const dep of deps) {
        if (ticketSet.has(dep)) {
          inDegree.set(id, (inDegree.get(id) || 0) + 1);
          if (!successors.has(dep)) successors.set(dep, new Set());
          successors.get(dep)!.add(id);
        }
      }
    }

    const layers: string[][] = [];
    let queue = Array.from(ticketSet).filter(
      (id) => (inDegree.get(id) || 0) === 0
    );

    while (queue.length > 0) {
      layers.push([...queue]);
      const nextQueue: string[] = [];
      for (const node of queue) {
        const succs = successors.get(node);
        if (!succs) continue;
        for (const succ of succs) {
          const newDeg = (inDegree.get(succ) || 1) - 1;
          inDegree.set(succ, newDeg);
          if (newDeg === 0) nextQueue.push(succ);
        }
      }
      queue = nextQueue;
    }

    return layers;
  }),
}));

import { buildExecutionPlan } from "@/lib/dependencies/scheduler";

describe("DAG Scheduler", () => {
  beforeEach(() => {
    mockGraph.clear();
  });

  describe("buildExecutionPlan", () => {
    it("returns a single layer for independent tickets", () => {
      const plan = buildExecutionPlan("proj1", ["a", "b", "c"]);
      expect(plan.layers).toHaveLength(1);
      expect(plan.layers[0]).toHaveLength(3);
      expect(plan.ticketStatus.size).toBe(3);
      for (const status of plan.ticketStatus.values()) {
        expect(status).toBe("pending");
      }
    });

    it("returns multiple layers for dependent tickets", () => {
      // b depends on a; c depends on b → three layers
      mockGraph.set("b", new Set(["a"]));
      mockGraph.set("c", new Set(["b"]));

      const plan = buildExecutionPlan("proj1", ["a", "b", "c"]);
      expect(plan.layers).toHaveLength(3);
      expect(plan.layers[0]).toEqual(["a"]);
      expect(plan.layers[1]).toEqual(["b"]);
      expect(plan.layers[2]).toEqual(["c"]);
    });

    it("groups independent branches in the same layer", () => {
      // b depends on a, c is independent, d depends on a
      mockGraph.set("b", new Set(["a"]));
      mockGraph.set("d", new Set(["a"]));

      const plan = buildExecutionPlan("proj1", ["a", "b", "c", "d"]);
      expect(plan.layers).toHaveLength(2);
      // First layer: a and c (no predecessors)
      expect(plan.layers[0].sort()).toEqual(["a", "c"]);
      // Second layer: b and d (both depend on a)
      expect(plan.layers[1].sort()).toEqual(["b", "d"]);
    });
  });
});
