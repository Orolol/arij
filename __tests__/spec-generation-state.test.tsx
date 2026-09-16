import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
import { useSpecGeneration } from "@/hooks/useSpecGeneration";
const fetchMock = vi.fn<typeof fetch>();
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
const response = (error?: string) => ({ ok: !error, status: error ? 409 : 200, json: async () => error ? { error } : { data: { epicsCreated: 0 } } }) as Response;
beforeEach(() => { fetchMock.mockReset(); navigation.refresh.mockClear(); vi.stubGlobal("fetch", fetchMock); });

describe("spec generation ownership", () => {
  it("dispatches once until settled and lets the server resolve the generation agent", async () => {
    const request = deferred();
    fetchMock.mockReturnValue(request.promise);
    const { result } = renderHook(() => useSpecGeneration("p1"));
    let completion!: Promise<unknown>;
    act(() => { completion = result.current.generateSpec(); void result.current.generateSpec(); });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/projects/p1/generate-spec", { method: "POST" });
    expect(result.current.generating).toBe(true);
    await act(async () => { request.resolve(response()); await completion; });
    expect(result.current.generating).toBe(false);
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });

  it("ignores old callbacks and completion when leaving and returning to the same project", async () => {
    const request = deferred();
    fetchMock.mockReturnValueOnce(request.promise);
    const { result, rerender } = renderHook(({ projectId }) => useSpecGeneration(projectId), { initialProps: { projectId: "p1" } });
    const oldCallback = result.current.generateSpec;
    let completion!: Promise<unknown>;
    act(() => { completion = oldCallback(); });
    rerender({ projectId: "p2" });
    rerender({ projectId: "p1" });
    await act(async () => { request.resolve(response("older proposal conflicts")); await completion; await oldCallback(); });
    expect(result.current.error).toBeNull();
    expect(result.current.generating).toBe(false);
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
