/**
 * A fake `ChildProcess` for the provider/spawn tests.
 *
 * WHY ONE COPY. Seven test files carried their own, and they had drifted in
 * ways that hid tests: five exposed `pid`/`exitCode`/`signalCode` (which the
 * kill path reads to decide between signalling the process and its group) and
 * two did not, so their kill assertions were exercising a different object
 * than production sees; three could push stderr, four could not; one collected
 * the stdin writes, the others discarded them. Each copy was "fine" for its
 * own file and silently weaker than its neighbour.
 *
 * The union is the shape a provider actually reads, plus the emitters a test
 * needs to drive it. Nothing here is provider-specific.
 *
 * NOT a `ChildProcess`: it is a structural stand-in for the surface
 * `lib/providers/base-provider.ts` and `lib/claude/spawn.ts` touch, so a test
 * that reaches for a member this omits fails loudly rather than silently
 * seeing `undefined`.
 */

import { vi } from "vitest";

export type FakeChildListener = (...args: unknown[]) => void;

export interface FakeChild {
  stdout: { on: (event: string, fn: (chunk: Buffer) => void) => void };
  stderr: { on: (event: string, fn: (chunk: Buffer) => void) => void };
  stdin: {
    on: (event: string, fn: FakeChildListener) => void;
    end: (chunk?: string) => void;
    write: (chunk: string) => void;
  };
  on: (event: string, fn: FakeChildListener) => void;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
  /**
   * A real live child reports a pid and null exit fields; the kill path reads
   * them to decide whether the signal goes to the process or to its group.
   */
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  /** Everything written to stdin, in order — `end` included, as a write. */
  stdinWrites: string[];
  emitStdout(text: string): void;
  emitStderr(text: string): void;
  emitClose(code: number | null): void;
  emitError(error: Error): void;
}

export interface FakeChildOptions {
  pid?: number;
  /** Start in the killed state, for tests that drive the post-kill path. */
  killed?: boolean;
}

export function createFakeChild(options: FakeChildOptions = {}): FakeChild {
  const listeners = new Map<string, FakeChildListener[]>();
  const stdoutListeners: Array<(chunk: Buffer) => void> = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];
  const stdinWrites: string[] = [];

  const register = (
    table: Map<string, FakeChildListener[]>,
    event: string,
    fn: FakeChildListener,
  ) => {
    const existing = table.get(event) ?? [];
    existing.push(fn);
    table.set(event, existing);
  };

  const child: FakeChild = {
    stdout: {
      on: (event, fn) => {
        if (event === "data") stdoutListeners.push(fn);
      },
    },
    stderr: {
      on: (event, fn) => {
        if (event === "data") stderrListeners.push(fn);
      },
    },
    stdin: {
      on: () => {},
      end: (chunk?: string) => {
        if (typeof chunk === "string") stdinWrites.push(chunk);
      },
      write: (chunk: string) => {
        stdinWrites.push(chunk);
      },
    },
    on: (event, fn) => register(listeners, event, fn),
    kill: vi.fn(),
    killed: options.killed ?? false,
    pid: options.pid ?? 4242,
    exitCode: null,
    signalCode: null,
    stdinWrites,
    emitStdout: (text) => {
      for (const fn of stdoutListeners) fn(Buffer.from(text));
    },
    emitStderr: (text) => {
      for (const fn of stderrListeners) fn(Buffer.from(text));
    },
    emitClose: (code) => {
      for (const fn of listeners.get("close") ?? []) fn(code);
    },
    emitError: (error) => {
      for (const fn of listeners.get("error") ?? []) fn(error);
    },
  };

  return child;
}
