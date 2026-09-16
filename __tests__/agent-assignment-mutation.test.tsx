import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAssignmentMutation } from "@/components/agents-workshop/useAssignmentMutation";

function pending() {
  let resolve!: (result: { ok: boolean; error?: string }) => void;
  const promise = new Promise<{ ok: boolean; error?: string }>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("assignment changes shared by the table and workshop", () => {
  it("tracks concurrent roles independently and prevents a duplicate save for either role", async () => {
    const build = pending();
    const review = pending();
    const assign = vi.fn().mockReturnValueOnce(build.promise).mockReturnValueOnce(review.promise);
    const view = renderHook(() => useAssignmentMutation("global", assign));
    act(() => {
      void view.result.current.updateAssignment("build", "a");
      void view.result.current.updateAssignment("review_code", "b");
      void view.result.current.updateAssignment("build", "c");
    });
    expect(assign).toHaveBeenCalledTimes(2);
    expect(view.result.current.savingRoles).toEqual(["build", "review_code"]);
    await act(async () => { build.resolve({ ok: true }); });
    expect(view.result.current.savingRoles).toEqual(["review_code"]);
    await act(async () => { review.resolve({ ok: false, error: "refused" }); });
    expect(view.result.current.errors.review_code).toBe("refused");
    expect(view.result.current.savingRoles).toEqual([]);
  });

  it("does not display an abandoned scope's error under another scope", async () => {
    const old = pending();
    const assign = vi.fn().mockReturnValue(old.promise);
    const view = renderHook(({ scope }) => useAssignmentMutation(scope, assign), { initialProps: { scope: "project" } });
    act(() => { void view.result.current.updateAssignment("build", "a"); });
    view.rerender({ scope: "global" });
    await act(async () => { old.resolve({ ok: false, error: "old project error" }); });
    expect(view.result.current.errors).toEqual({});
    expect(view.result.current.savingRoles).toEqual([]);
  });
});
