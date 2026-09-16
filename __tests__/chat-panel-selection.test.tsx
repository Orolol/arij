import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { usePanelLayout } from "@/hooks/usePanelLayout";

beforeEach(() => { window.localStorage.clear(); });

it("restores a saved conversation only after the asynchronous list arrives", () => {
  const key = "arij.unified-chat-panel.active.p1";
  window.localStorage.setItem(key, "saved");
  const setActiveId = vi.fn();
  const { rerender } = renderHook(({ conversations, activeId }) => usePanelLayout({ projectId: "p1", conversations, activeId, setActiveId }), {
    initialProps: { conversations: [] as { id: string }[], activeId: null as string | null },
  });
  expect(setActiveId).not.toHaveBeenCalled();
  rerender({ conversations: [{ id: "first" }, { id: "saved" }], activeId: "first" });
  expect(setActiveId).toHaveBeenCalledWith("saved");
  expect(window.localStorage.getItem(key)).toBe("saved");
  rerender({ conversations: [{ id: "first" }, { id: "saved" }], activeId: "saved" });
  rerender({ conversations: [{ id: "first" }, { id: "saved" }], activeId: "first" });
  expect(window.localStorage.getItem(key)).toBe("first");
  expect(setActiveId).toHaveBeenCalledTimes(1);
});

it("restores each project's selection independently", () => {
  window.localStorage.setItem("arij.unified-chat-panel.active.p1", "a");
  window.localStorage.setItem("arij.unified-chat-panel.active.p2", "b");
  const setActiveId = vi.fn();
  const { rerender } = renderHook(({ projectId, conversations }) => usePanelLayout({ projectId, conversations, activeId: null, setActiveId }), {
    initialProps: { projectId: "p1", conversations: [{ id: "a" }] },
  });
  rerender({ projectId: "p2", conversations: [{ id: "b" }] });
  expect(setActiveId.mock.calls.map(([id]) => id)).toEqual(["a", "b"]);
});

it("resizes relative to the inset container, rather than the window origin", () => {
  window.localStorage.setItem("arij.unified-chat-panel.state.p1", "expanded");
  const { result } = renderHook(() => usePanelLayout({ projectId: "p1", conversations: [], activeId: null, setActiveId: vi.fn() }));
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 1000 });
  container.getBoundingClientRect = () => ({ left: 100, right: 1100, width: 1000 } as DOMRect);
  act(() => { result.current.containerRef.current = container; result.current.startDrag(); });
  act(() => { window.dispatchEvent(new MouseEvent("mousemove", { clientX: 700 })); });
  expect(window.localStorage.getItem("arij.unified-chat-panel.ratio.p1")).toBe("0.4000");
});
