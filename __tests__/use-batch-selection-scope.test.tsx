import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBatchSelection } from "@/hooks/useBatchSelection";

afterEach(() => { vi.unstubAllGlobals(); });

describe("batch selection request lifetime", () => {
  it("does not revive an aborted A selection after selecting B then A again", async () => {
    const replies: ((value: unknown) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { replies.push(resolve); })));
    const { result } = renderHook(() => useBatchSelection("p"));
    act(() => result.current.setSelectedTicketIds(["a"]));
    act(() => result.current.setSelectedTicketIds(["b"]));
    act(() => result.current.setSelectedTicketIds(["a"]));
    await act(async () => replies[2]({ ok: true, json: async () => ({ data: { all: ["a", "current"], autoIncluded: ["current"] } }) }));
    await act(async () => replies[0]({ ok: true, json: async () => ({ data: { all: ["a", "stale"], autoIncluded: ["stale"] } }) }));
    expect([...result.current.allSelected]).toEqual(["a", "current"]);
  });

  it("clears selection and cancels dependency resolution when changing projects", async () => {
    let finish!: (value: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    const { result, rerender } = renderHook(({ project }) => useBatchSelection(project), { initialProps: { project: "p" } });
    act(() => result.current.setSelectedTicketIds(["a"]));
    rerender({ project: "other" });
    await act(async () => finish({ ok: true, json: async () => ({ data: { all: ["a", "stale"] } }) }));
    expect(result.current.allSelected.size).toBe(0);
    expect(result.current.loading).toBe(false);
  });
});
