// @vitest-environment node
/**
 * GET /api/projects/:projectId/events — the SSE stream's teardown.
 *
 * A connection ends by one of two paths: the client aborts the request
 * (`request.signal`), or the stream consumer cancels the body (`cancel()` on
 * the underlying source — what `Response` does when the socket closes under
 * it). Both must release BOTH resources the handler holds: the event-bus
 * subscription and the 30 s heartbeat interval. `cancel()` used to release
 * only the subscription; the interval survived until its next enqueue threw
 * against the closed controller, up to one heartbeat period later. The fake
 * timer count is the pin: it must read zero once the stream is gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eventBus } from "@/lib/events/bus";
import { GET } from "@/app/api/projects/[projectId]/events/route";

async function openStream(projectId: string, signal?: AbortSignal) {
  const request = new NextRequest(
    `http://localhost/api/projects/${projectId}/events`,
    signal ? { signal } : undefined
  );
  const response = await GET(request, {
    params: Promise.resolve({ projectId }),
  });
  const reader = response.body!.getReader();
  // The first chunk is the synchronous `connected` event; reading it proves
  // the source's `start()` ran and both resources are held.
  const first = await reader.read();
  expect(new TextDecoder().decode(first.value)).toContain('"type":"connected"');
  return reader;
}

describe("GET /api/projects/:projectId/events teardown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds one subscription and one heartbeat interval while the stream is open", async () => {
    const projectId = "proj-sse-open";
    const reader = await openStream(projectId);

    expect(eventBus.listenerCount(projectId)).toBe(1);
    expect(vi.getTimerCount()).toBe(1);

    await reader.cancel();
  });

  it("cancel() clears the heartbeat interval as well as the subscription", async () => {
    const projectId = "proj-sse-cancel";
    const reader = await openStream(projectId);

    await reader.cancel();

    expect(vi.getTimerCount()).toBe(0);
    expect(eventBus.listenerCount(projectId)).toBe(0);
  });

  it("abort clears both, and a later cancel is harmless", async () => {
    const projectId = "proj-sse-abort";
    const controller = new AbortController();
    const reader = await openStream(projectId, controller.signal);

    controller.abort();

    expect(vi.getTimerCount()).toBe(0);
    expect(eventBus.listenerCount(projectId)).toBe(0);
    await expect(reader.read()).resolves.toMatchObject({ done: true });

    // Both paths fire for one connection when a client disconnects; the
    // second must not throw or resurrect anything.
    await expect(reader.cancel()).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops writing heartbeats once the consumer is gone", async () => {
    const projectId = "proj-sse-quiet";
    const reader = await openStream(projectId);
    await reader.cancel();

    // A surviving interval would enqueue against the cancelled controller
    // here; with the interval cleared nothing runs at all.
    expect(() => vi.advanceTimersByTime(90_000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
