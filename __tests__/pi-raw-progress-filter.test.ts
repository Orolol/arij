/**
 * omp streams a `tool_execution_update` event per pipe read while a tool
 * runs, and each one carries the WHOLE output accumulated so far. Persisting
 * them as raw chunks stored one `npm test` as 517 frames and 24.7 MB for
 * 51 KB of final text, and 543 MB of the 817 MB of omp raw output on the live
 * database were such frames. The pi-family providers now persist the raw
 * stream per NDJSON line with those frames dropped; the `tool_execution_end`
 * event, which carries the result once, is kept.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock("child_process", () => ({
  spawn: mockSpawn,
  execFile: vi.fn(),
  execFileSync: vi.fn(() => "omp/18.1.13\n"),
  default: { spawn: mockSpawn, execFile: vi.fn(), execFileSync: vi.fn(() => "omp/18.1.13\n") },
}));

import {
  createPiRawLineFilter,
  isPiProgressEventLine,
  PI_PROGRESS_EVENT_TYPE,
} from "@/lib/providers/pi";
import { OhMyPiProvider } from "@/lib/providers/oh-my-pi";
import type { ProviderChunk } from "@/lib/providers/types";

const update = (n: number) =>
  `{"type":"${PI_PROGRESS_EVENT_TYPE}","toolCallId":"call_1","partialResult":"${"out".repeat(n)}"}`;
const end = `{"type":"tool_execution_end","toolCallId":"call_1","result":"outoutout"}`;
const start = `{"type":"tool_execution_start","toolCallId":"call_1","toolName":"bash"}`;

describe("createPiRawLineFilter", () => {
  it("drops progress frames and keeps every other line", () => {
    const out: string[] = [];
    const filter = createPiRawLineFilter((t) => out.push(t));
    filter.push(`${start}\n${update(1)}\n${update(2)}\n${end}\n`);
    filter.flush();
    expect(out).toEqual([`${start}\n`, `${end}\n`]);
  });

  it("carries a line split across pipe reads and emits the remainder at flush", () => {
    const out: string[] = [];
    const filter = createPiRawLineFilter((t) => out.push(t));
    const whole = `${start}\n${update(3)}\n${end}`;
    for (let i = 0; i < whole.length; i += 7) filter.push(whole.slice(i, i + 7));
    expect(out).toEqual([`${start}\n`]);
    filter.flush();
    expect(out).toEqual([`${start}\n`, end]);
  });

  it("only matches the event type at the head of the line", () => {
    expect(isPiProgressEventLine(update(1))).toBe(true);
    expect(isPiProgressEventLine(end)).toBe(false);
    // A tool result that quotes the event name is not a progress frame.
    expect(
      isPiProgressEventLine(`{"type":"tool_execution_end","result":"saw ${PI_PROGRESS_EVENT_TYPE}"}`)
    ).toBe(false);
  });
});

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { on: vi.fn(), end: vi.fn() };
  pid = 4242;
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn();
}

describe("OhMyPiProvider raw stream", () => {
  let child: FakeChild;

  beforeEach(() => {
    child = new FakeChild();
    mockSpawn.mockReset();
    mockSpawn.mockImplementation(() => child);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("persists one raw chunk per kept NDJSON line, none for progress frames", async () => {
    const chunks: ProviderChunk[] = [];
    const session = new OhMyPiProvider().spawn({
      sessionId: "s-omp",
      prompt: "run the tests",
      cwd: "/tmp/work",
      mode: "code",
      onChunk: (c) => chunks.push(c),
    });

    // Two pipe reads: the second starts in the middle of a progress frame.
    const firstRead = `${start}\n${update(2)}\n${update(4).slice(0, 20)}`;
    const secondRead = `${update(4).slice(20)}\n${end}\n`;
    child.stdout.emit("data", Buffer.from(firstRead));
    child.stdout.emit("data", Buffer.from(secondRead));
    child.stderr.emit("data", Buffer.from("warning: something\n"));
    child.exitCode = 0;
    child.emit("close", 0);
    await session.promise;

    const raw = chunks.filter((c) => c.streamType === "raw");
    expect(raw.map((c) => c.text)).toEqual([`${start}\n`, `${end}\n`, "warning: something\n"]);
    // stdout lines are numbered by kept line, stderr by pipe read, as before.
    expect(raw.map((c) => c.chunkKey)).toEqual(["stdout:1", "stdout:2", "stderr:1"]);
  });

  it("flushes a final line with no trailing newline at exit", async () => {
    const chunks: ProviderChunk[] = [];
    const session = new OhMyPiProvider().spawn({
      sessionId: "s-omp",
      prompt: "p",
      cwd: "/tmp/work",
      mode: "code",
      onChunk: (c) => chunks.push(c),
    });
    child.stdout.emit("data", Buffer.from(`${start}\n${end}`));
    child.exitCode = 0;
    child.emit("close", 0);
    await session.promise;

    const raw = chunks.filter((c) => c.streamType === "raw").map((c) => c.text);
    expect(raw).toEqual([`${start}\n`, end]);
  });

  it("does not build the filter when nobody listens", () => {
    const session = new OhMyPiProvider().spawn({
      sessionId: "s-omp",
      prompt: "p",
      cwd: "/tmp/work",
      mode: "code",
    });
    expect(() => child.stdout.emit("data", Buffer.from(update(1)))).not.toThrow();
    session.kill();
  });
});
