/**
 * Live output for claude-code sessions.
 *
 * `--output-format json` yields one document at exit, so the LIVE LOG of a
 * claude-code session — the default provider, 1,288 sessions on the live
 * database with zero raw chunks — stayed empty for its whole duration. With
 * a listener, spawnClaude runs in stream-json mode, relays every event line
 * as it arrives, and still hands the caller the closing `result` envelope,
 * which is the same document json mode prints. ClaudeCodeProvider turns
 * those lines into `raw` chunks and the final text into the same
 * `final-output` / `final-response` chunks the other providers emit.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: mocks.spawn,
  execFile: vi.fn(),
  default: { spawn: mocks.spawn, execFile: vi.fn() },
}));

vi.mock("@/lib/claude/logger", () => ({
  createStreamLog: vi.fn(() => null),
  appendStreamEvent: vi.fn(),
  appendStderrEvent: vi.fn(),
  endStreamLog: vi.fn(),
}));

import { spawnClaude } from "@/lib/claude/spawn";
import { ClaudeCodeProvider } from "@/lib/providers/claude-code";
import type { ProviderChunk } from "@/lib/providers/types";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { on: vi.fn(), end: vi.fn() };
  pid = 4243;
  exitCode: number | null = null;
  signalCode: string | null = null;
  kill = vi.fn();
}

const SESSION_ID = "0b1d2e3f-1111-4222-8333-444455556666";
const events = [
  `{"type":"system","subtype":"init","session_id":"${SESSION_ID}"}`,
  `{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Working…"}]},"session_id":"${SESSION_ID}"}`,
  `{"type":"result","subtype":"success","result":"All done.","session_id":"${SESSION_ID}","duration_ms":10,"usage":{"input_tokens":5,"output_tokens":2}}`,
];

let child: FakeChild;

beforeEach(() => {
  child = new FakeChild();
  mocks.spawn.mockReset();
  mocks.spawn.mockImplementation(() => child);
});

describe("spawnClaude with a line listener", () => {
  it("runs in stream-json mode and relays each line as it arrives", async () => {
    const lines: string[] = [];
    const { promise } = spawnClaude({
      mode: "code",
      prompt: "do it",
      onRawLine: (l) => lines.push(l),
    });

    const args = mocks.spawn.mock.calls[0][1] as string[];
    expect(args[args.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(args).toContain("--verbose");

    // Two pipe reads, the second cutting a line in half.
    const text = events.join("\n") + "\n";
    child.stdout.emit("data", Buffer.from(text.slice(0, 40)));
    expect(lines).toEqual([]);
    child.stdout.emit("data", Buffer.from(text.slice(40)));
    expect(lines).toEqual(events);

    child.exitCode = 0;
    child.emit("close", 0);
    const result = await promise;
    // The caller sees the closing envelope, not the whole event log.
    expect(result.success).toBe(true);
    expect(result.result).toBe(events[2]);
    expect(result.cliSessionId).toBe(SESSION_ID);
  });

  it("keeps json mode and the raw stdout when nobody listens", async () => {
    const { promise } = spawnClaude({ mode: "code", prompt: "do it" });
    const args = mocks.spawn.mock.calls[0][1] as string[];
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    expect(args).not.toContain("--verbose");

    child.stdout.emit("data", Buffer.from(events[2]));
    child.exitCode = 0;
    child.emit("close", 0);
    const result = await promise;
    expect(result.result).toBe(events[2]);
  });

  it("falls back to the full stdout when the stream ends without a result envelope", async () => {
    const { promise } = spawnClaude({ mode: "code", prompt: "do it", onRawLine: () => {} });
    child.stdout.emit("data", Buffer.from(events[0] + "\n" + events[1] + "\n"));
    child.exitCode = 1;
    child.emit("close", 1);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.result).toContain(events[1]);
    // The NDJSON-aware parsers still find the session id.
    expect(result.cliSessionId).toBe(SESSION_ID);
  });

  it("relays a last line that has no trailing newline", async () => {
    const lines: string[] = [];
    const { promise } = spawnClaude({ mode: "code", prompt: "p", onRawLine: (l) => lines.push(l) });
    child.stdout.emit("data", Buffer.from(events.join("\n")));
    child.exitCode = 0;
    child.emit("close", 0);
    await promise;
    expect(lines).toEqual(events);
  });
});

describe("ClaudeCodeProvider chunks", () => {
  it("emits raw chunks per line and the final output/response chunks", async () => {
    const chunks: ProviderChunk[] = [];
    const session = new ClaudeCodeProvider().spawn({
      sessionId: "s-cc",
      prompt: "do it",
      cwd: "/tmp/work",
      mode: "code",
      onChunk: (c) => chunks.push(c),
    });
    child.stdout.emit("data", Buffer.from(events.join("\n") + "\n"));
    child.exitCode = 0;
    child.emit("close", 0);
    const result = await session.promise;

    expect(result.success).toBe(true);
    const raw = chunks.filter((c) => c.streamType === "raw");
    expect(raw.map((c) => c.text)).toEqual(events.map((e) => `${e}\n`));
    expect(raw.map((c) => c.chunkKey)).toEqual(["stdout:1", "stdout:2", "stdout:3"]);

    const finals = chunks.filter((c) => c.streamType !== "raw");
    expect(finals).toEqual([
      expect.objectContaining({ streamType: "output", chunkKey: "final-output", text: "All done." }),
      expect.objectContaining({ streamType: "response", chunkKey: "final-response", text: "All done." }),
    ]);
  });

  it("emits nothing and stays in json mode without a listener", async () => {
    const session = new ClaudeCodeProvider().spawn({
      sessionId: "s-cc",
      prompt: "do it",
      cwd: "/tmp/work",
      mode: "code",
    });
    const args = mocks.spawn.mock.calls[0][1] as string[];
    expect(args[args.indexOf("--output-format") + 1]).toBe("json");
    child.stdout.emit("data", Buffer.from(events[2]));
    child.exitCode = 0;
    child.emit("close", 0);
    const result = await session.promise;
    expect(result.result).toBe(events[2]);
  });
});
