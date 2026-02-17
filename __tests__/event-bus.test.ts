import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventBus, type TicketEvent } from "@/lib/events/bus";

function makeEvent(overrides?: Partial<TicketEvent>): TicketEvent {
  return {
    type: "ticket:moved",
    projectId: "proj-1",
    epicId: "epic-1",
    data: { fromStatus: "backlog", toStatus: "todo" },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("EventBus", () => {
  beforeEach(() => {
    // We can't reset the singleton, so we ensure tests clean up after themselves
  });

  it("delivers events to subscribers of the same project", () => {
    const listener = vi.fn();
    const unsub = eventBus.subscribe("proj-test-1", listener);

    const event = makeEvent({ projectId: "proj-test-1" });
    eventBus.emit(event);

    expect(listener).toHaveBeenCalledWith(event);
    unsub();
  });

  it("does not deliver events to subscribers of different projects", () => {
    const listener = vi.fn();
    const unsub = eventBus.subscribe("proj-test-2", listener);

    eventBus.emit(makeEvent({ projectId: "proj-other" }));

    expect(listener).not.toHaveBeenCalled();
    unsub();
  });

  it("supports multiple listeners per project", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    const unsub1 = eventBus.subscribe("proj-test-3", listener1);
    const unsub2 = eventBus.subscribe("proj-test-3", listener2);

    const event = makeEvent({ projectId: "proj-test-3" });
    eventBus.emit(event);

    expect(listener1).toHaveBeenCalledWith(event);
    expect(listener2).toHaveBeenCalledWith(event);
    unsub1();
    unsub2();
  });

  it("stops delivering after unsubscribe", () => {
    const listener = vi.fn();
    const unsub = eventBus.subscribe("proj-test-4", listener);

    unsub();
    eventBus.emit(makeEvent({ projectId: "proj-test-4" }));

    expect(listener).not.toHaveBeenCalled();
  });

  it("continues delivering to other listeners if one throws", () => {
    const badListener = vi.fn(() => { throw new Error("boom"); });
    const goodListener = vi.fn();
    const unsub1 = eventBus.subscribe("proj-test-5", badListener);
    const unsub2 = eventBus.subscribe("proj-test-5", goodListener);

    const event = makeEvent({ projectId: "proj-test-5" });
    eventBus.emit(event);

    expect(badListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalledWith(event);
    unsub1();
    unsub2();
  });

  it("reports listener count correctly", () => {
    expect(eventBus.listenerCount("proj-test-6")).toBe(0);
    const unsub = eventBus.subscribe("proj-test-6", vi.fn());
    expect(eventBus.listenerCount("proj-test-6")).toBe(1);
    unsub();
    expect(eventBus.listenerCount("proj-test-6")).toBe(0);
  });
});
