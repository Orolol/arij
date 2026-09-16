/**
 * A fake `EventSource` for the page tests.
 *
 * WHY ONE COPY. Seven test files pasted the same six-line stub (three nullable
 * handlers and a no-op `close`), and an eighth — the memory panel — carried a
 * longer variant that additionally tracks live instances and can `emit` a
 * server-sent event. The stubs drifted in the only way that matters: the seven
 * could not deliver an event at all, so a page's SSE handler was only ever
 * exercised through its polling fallback, while the eighth tested the real
 * path. This is the union.
 *
 * NOT an `EventSource`: it is a structural stand-in for the surface
 * `hooks/useProjectEvents.ts` touches (`onopen`/`onmessage`/`onerror`/`close`),
 * so a hook that reaches for a member this omits fails loudly.
 */

export interface MockEventSourceMessage {
  data: string;
}

export class MockEventSource {
  /** Every instance constructed since the last `resetMockEventSources()`. */
  static readonly instances: MockEventSource[] = [];

  static reset(): void {
    MockEventSource.instances.length = 0;
  }

  /** The most recently constructed instance, which is the page's own. */
  static latest(): MockEventSource {
    const source = MockEventSource.instances.at(-1);
    if (!source) throw new Error("no MockEventSource was constructed");
    return source;
  }

  onopen: (() => void) | null = null;
  onmessage: ((event: MockEventSourceMessage) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_url?: string) {
    MockEventSource.instances.push(this);
  }

  close(): void {
    const index = MockEventSource.instances.indexOf(this);
    if (index >= 0) MockEventSource.instances.splice(index, 1);
  }

  /** Opens the stream, for the hook's `onopen` path. */
  open(): void {
    this.onopen?.();
  }

  /**
   * Delivers one raw frame. `data` is stringified unless already a string, so
   * a caller can pass the object it means rather than a pre-encoded envelope.
   */
  emit(data: unknown): void {
    this.onmessage?.({
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
  }

  /**
   * Delivers one `TicketEvent` in the envelope the SSE route sends
   * (`{ type, projectId, data, timestamp }`), which is what
   * `useProjectEvents` parses. The shape is the route's contract, so it is
   * built here once instead of at every call site.
   */
  emitEvent(
    type: string,
    options: { data?: Record<string, unknown>; projectId?: string } = {},
  ): void {
    this.emit({
      type,
      projectId: options.projectId ?? "proj-1",
      data: options.data ?? {},
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Installs the fake as the global `EventSource` and clears the instance list.
 * Returns a restore function for `afterEach`.
 */
export function installMockEventSource(): () => void {
  const original = (globalThis as { EventSource?: unknown }).EventSource;
  MockEventSource.reset();
  (globalThis as { EventSource?: unknown }).EventSource = MockEventSource;
  return () => {
    (globalThis as { EventSource?: unknown }).EventSource = original;
  };
}
