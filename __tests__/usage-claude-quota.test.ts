import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLAUDE_USAGE_ARGV,
  PROBE_TIMEOUT_MS,
  buildGetUsageRequestLine,
  fetchClaudeQuota,
  parseClaudeQuota,
  runClaudeProbe,
  type ClaudeProbeRunner,
} from "@/lib/usage/claude-quota";
import {
  CLAUDE_USAGE_MALFORMED_NDJSON,
  CLAUDE_USAGE_OK_NDJSON,
  CLAUDE_USAGE_UNAVAILABLE_NDJSON,
} from "@/__tests__/fixtures/quota-fixtures";

// Contract: vitest NEVER spawns a real CLI. The parser runs on pinned fixture
// transcripts; the fetcher runs through an injected runner; the spawn runner
// itself runs against a fake child_process (mocked below).

vi.mock("child_process", () => {
  const spawn = vi.fn();
  return { spawn, default: { spawn } };
});
import { spawn } from "child_process";
const spawnMock = vi.mocked(spawn);

const RID = "req-fixture-1";
const OK = CLAUDE_USAGE_OK_NDJSON.replaceAll("REQ_ID", RID);

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spawnMock.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.useRealTimers();
});

describe("CLAUDE_USAGE_ARGV — pinned spawn surface", () => {
  it("is exactly the live-verified probe argv", () => {
    expect([...CLAUDE_USAGE_ARGV]).toEqual([
      "claude",
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  it("never uses --bare (it skips OAuth => rate_limits_available:false)", () => {
    expect(CLAUDE_USAGE_ARGV).not.toContain("--bare");
  });

  it("pins the 10s hard timeout", () => {
    expect(PROBE_TIMEOUT_MS).toBe(10_000);
  });
});

describe("buildGetUsageRequestLine", () => {
  it("builds the exact control_request line — a metadata read, never a prompt", () => {
    expect(JSON.parse(buildGetUsageRequestLine("abc"))).toEqual({
      type: "control_request",
      request_id: "abc",
      request: { subtype: "get_usage" },
    });
  });

  it("is a single line (NDJSON discipline)", () => {
    expect(buildGetUsageRequestLine("abc")).not.toContain("\n");
  });
});

describe("parseClaudeQuota — pinned fixture transcripts", () => {
  it("maps the stable subset of the success transcript verbatim", () => {
    expect(parseClaudeQuota(OK, RID)).toEqual({
      subscriptionType: "max",
      fiveHour: { utilizationPercent: 34, resetsAtIso: "2026-08-18T16:00:00+00:00" },
      sevenDay: { utilizationPercent: 61, resetsAtIso: "2026-08-21T09:00:00+00:00" },
      sevenDayOpus: {
        utilizationPercent: 12,
        resetsAtIso: "2026-08-21T09:00:00+00:00",
      },
      sevenDaySonnet: null,
      modelScoped: [
        {
          displayName: "Opus 4.5",
          utilizationPercent: 12,
          resetsAtIso: "2026-08-21T09:00:00+00:00",
        },
      ],
      extraUsage: {
        isEnabled: true,
        monthlyLimit: 100,
        usedCredits: 12.5,
        utilizationPercent: 12.5,
      },
    });
  });

  it("ignores churn keys (seven_day_cowork, tangelo, iguana_necktie) silently", () => {
    const quota = parseClaudeQuota(OK, RID)!;
    // Tolerant parsing: unknown keys never leak into the stable subset and
    // never earn a log line.
    expect(JSON.stringify(quota)).not.toMatch(/cowork|tangelo|iguana/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("keeps resets_at as the provider's ISO STRING — never converted to unix", () => {
    const quota = parseClaudeQuota(OK, RID)!;
    expect(typeof quota.fiveHour!.resetsAtIso).toBe("string");
    expect(quota.fiveHour!.resetsAtIso).toBe("2026-08-18T16:00:00+00:00");
  });

  it("gates everything on rate_limits_available === true", () => {
    expect(
      parseClaudeQuota(
        CLAUDE_USAGE_UNAVAILABLE_NDJSON.replaceAll("REQ_ID", RID),
        RID,
      ),
    ).toBeNull();
  });

  it("returns null on a truncated mid-stream transcript without throwing", () => {
    expect(() =>
      parseClaudeQuota(CLAUDE_USAGE_MALFORMED_NDJSON, RID),
    ).not.toThrow();
    expect(parseClaudeQuota(CLAUDE_USAGE_MALFORMED_NDJSON, RID)).toBeNull();
  });

  it("returns null when the response carries a different request_id", () => {
    expect(parseClaudeQuota(OK, "some-other-id")).toBeNull();
  });

  it("returns null on empty stdout", () => {
    expect(parseClaudeQuota("", RID)).toBeNull();
  });

  it("drops an unparseable window while keeping a healthy sibling", () => {
    const line = JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: RID,
        response: {
          subscription_type: "max",
          rate_limits_available: true,
          rate_limits: {
            five_hour: { resets_at: "2026-08-18T16:00:00+00:00" }, // no utilization
            seven_day: { utilization: 61, resets_at: "2026-08-23T19:00:00+00:00" },
          },
        },
      },
    });
    const quota = parseClaudeQuota(line, RID)!;
    expect(quota.fiveHour).toBeNull();
    expect(quota.sevenDay?.utilizationPercent).toBe(61);
    expect(quota.subscriptionType).toBe("max");
  });

  it("returns null when window-key churn leaves nothing parseable (codex >=1-bucket rule)", () => {
    // rate_limits_available:true but every field unusable: promoting this to a
    // live card would demote the metered truth behind zero gauges.
    const line = JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: RID,
        response: {
          subscription_type: "max",
          rate_limits_available: true,
          rate_limits: {
            five_hour: { resets_at: "2026-08-18T16:00:00+00:00" }, // no utilization
            seven_day: { utilization: "61" }, // wrong type
          },
        },
      },
    });
    expect(parseClaudeQuota(line, RID)).toBeNull();
  });

  it("degrades a non-string resets_at to null while keeping the gauge", () => {
    const line = JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: RID,
        response: {
          rate_limits_available: true,
          rate_limits: { five_hour: { utilization: 12, resets_at: 12345 } },
        },
      },
    });
    expect(parseClaudeQuota(line, RID)!.fiveHour).toEqual({
      utilizationPercent: 12,
      resetsAtIso: null,
    });
  });

  it("drops model_scoped entries missing display_name or finite utilization", () => {
    const line = JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: RID,
        response: {
          rate_limits_available: true,
          rate_limits: {},
          model_scoped: [
            { display_name: "Opus 4.5", utilization: 12 },
            { utilization: 5 },
            { display_name: "Haiku 4.5", utilization: "NaN" },
            "noise",
          ],
        },
      },
    });
    expect(parseClaudeQuota(line, RID)!.modelScoped).toEqual([
      { displayName: "Opus 4.5", utilizationPercent: 12, resetsAtIso: null },
    ]);
  });
});

describe("fetchClaudeQuota — injectable runner seam", () => {
  it("passes the pinned argv/timeout and a get_usage line, then parses", async () => {
    const runner: ClaudeProbeRunner = vi.fn(
      async (argv, stdinLine, timeoutMs) => {
        expect([...argv]).toEqual([...CLAUDE_USAGE_ARGV]);
        expect(timeoutMs).toBe(PROBE_TIMEOUT_MS);
        const request = JSON.parse(stdinLine);
        expect(request.type).toBe("control_request");
        expect(request.request).toEqual({ subtype: "get_usage" });
        expect(typeof request.request_id).toBe("string");
        return CLAUDE_USAGE_OK_NDJSON.replaceAll("REQ_ID", request.request_id);
      },
    );
    const quota = await fetchClaudeQuota(runner);
    expect(quota?.subscriptionType).toBe("max");
    expect(quota?.fiveHour?.utilizationPercent).toBe(34);
  });

  it("resolves null when the runner resolves null (timeout/ENOENT path)", async () => {
    expect(await fetchClaudeQuota(async () => null)).toBeNull();
  });

  it("resolves null (never throws) when the runner rejects", async () => {
    await expect(
      fetchClaudeQuota(async () => {
        throw new Error("spawn exploded");
      }),
    ).resolves.toBeNull();
  });

  it("resolves null with ONE dev-log line on an unusable response", async () => {
    expect(await fetchClaudeQuota(async () => "not json at all")).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

/** Fake child for exercising the spawn runner without a real process. */
import { EventEmitter } from "events";

interface FakeChildProc extends EventEmitter {
  stdout: EventEmitter;
  stdin: EventEmitter & { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChildProc {
  const child = new EventEmitter() as FakeChildProc;
  child.stdout = new EventEmitter();
  const stdin = new EventEmitter() as FakeChildProc["stdin"];
  stdin.write = vi.fn();
  stdin.end = vi.fn();
  child.stdin = stdin;
  child.kill = vi.fn();
  child.unref = vi.fn();
  return child;
}

describe("runClaudeProbe — spawn semantics against a fake child_process", () => {
  it("spawns argv-array (no shell), writes ONE line, closes stdin immediately", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const promise = runClaudeProbe(CLAUDE_USAGE_ARGV, "REQUEST_LINE", 10_000);

    expect(spawnMock).toHaveBeenCalledWith(
      "claude",
      [...CLAUDE_USAGE_ARGV.slice(1)],
      expect.objectContaining({ shell: false, stdio: ["pipe", "pipe", "ignore"] }),
    );
    // Spawn-safety: the single metadata line, then EOF — no prompt can follow.
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
    expect(child.stdin.write).toHaveBeenCalledWith("REQUEST_LINE\n");
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
    expect(child.unref).toHaveBeenCalled();

    child.stdout.emit("data", Buffer.from(OK + "\n"));
    expect(await promise).toBe(OK + "\n");
  });

  it("resolves EARLY on the control_response line and SIGKILLs the child", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const promise = runClaudeProbe(CLAUDE_USAGE_ARGV, "L", 10_000);
    // First chunk: init noise only — must not settle yet.
    child.stdout.emit("data", Buffer.from('{"type":"system","subtype":"init"}\n'));
    child.stdout.emit("data", Buffer.from(OK.split("\n")[1] + "\n"));

    const stdout = await promise;
    expect(stdout).toContain('"control_response"');
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("resolves null on the hard timeout and SIGKILLs", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const promise = runClaudeProbe(CLAUDE_USAGE_ARGV, "L", 10_000);
    child.stdout.emit("data", Buffer.from('{"type":"system"}\n')); // never answers
    vi.advanceTimersByTime(10_001);

    expect(await promise).toBeNull();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("resolves null when the binary is missing (spawn error event)", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const promise = runClaudeProbe(CLAUDE_USAGE_ARGV, "L", 10_000);
    child.emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect(await promise).toBeNull();
  });

  it("resolves null when the process exits before answering", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const promise = runClaudeProbe(CLAUDE_USAGE_ARGV, "L", 10_000);
    child.stdout.emit("data", Buffer.from('{"type":"system"}\n'));
    child.emit("close", 1);
    expect(await promise).toBeNull();
  });
});
