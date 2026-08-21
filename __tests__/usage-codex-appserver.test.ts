import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPSERVER_TIMEOUT_MS,
  CODEX_APPSERVER_ARGV,
  INITIALIZED_FRAME,
  buildInitializeFrame,
  buildRateLimitsFrame,
  buildUsageFrame,
  fetchCodexLiveQuota,
  findResponseFrame,
  parseCodexLiveQuota,
  runCodexAppServerProbe,
  type AppServerRunner,
} from "@/lib/usage/codex-appserver";
import {
  CODEX_FRAMES_DUAL_WINDOW,
  CODEX_FRAMES_NO_RESPONSE,
  CODEX_FRAMES_OK,
} from "@/__tests__/fixtures/quota-fixtures";

// Contract: vitest NEVER spawns a real CLI. Parsers run on pinned fixture
// frames; the fetcher runs through an injected runner; the spawn runner runs
// against a fake child_process (mocked below).

vi.mock("child_process", () => {
  const spawn = vi.fn();
  return { spawn, default: { spawn } };
});
import { spawn } from "child_process";
const spawnMock = vi.mocked(spawn);

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spawnMock.mockReset();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.useRealTimers();
});

describe("frame builders — the complete allowed protocol surface", () => {
  it("pins the argv (JSON-RPC over stdio, no extra flags)", () => {
    expect([...CODEX_APPSERVER_ARGV]).toEqual(["codex", "app-server"]);
  });

  it("builds the initialize frame with Arij's clientInfo", () => {
    expect(JSON.parse(buildInitializeFrame(1))).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "arij", title: "Arij", version: "0.1.0" } },
    });
  });

  it("pins the initialized notification verbatim", () => {
    expect(INITIALIZED_FRAME).toBe('{"jsonrpc":"2.0","method":"initialized"}');
  });

  it("builds the two account reads — and ONLY those (never account/read)", () => {
    expect(JSON.parse(buildRateLimitsFrame(2))).toEqual({
      jsonrpc: "2.0",
      id: 2,
      method: "account/rateLimits/read",
      params: {},
    });
    expect(JSON.parse(buildUsageFrame(3))).toEqual({
      jsonrpc: "2.0",
      id: 3,
      method: "account/usage/read",
      params: {},
    });
    // account/read returns the account EMAIL — probe-only, never production.
    for (const frame of [buildRateLimitsFrame(2), buildUsageFrame(3)]) {
      expect(JSON.parse(frame).method).not.toBe("account/read");
    }
  });

  it("pins the 10s hard timeout", () => {
    expect(APPSERVER_TIMEOUT_MS).toBe(10_000);
  });
});

describe("findResponseFrame", () => {
  it("matches on id + result without requiring a jsonrpc key", () => {
    const result = findResponseFrame(CODEX_FRAMES_OK, 1);
    expect(result).toMatchObject({ codexHome: "/home/user/.codex" });
  });

  it("skips notifications and unparseable noise", () => {
    const lines = [
      "garbage {not json",
      '{"method":"remoteControl/status/changed","params":{"enabled":false}}',
      '{"id":7,"result":{"ok":true}}',
    ];
    expect(findResponseFrame(lines, 7)).toEqual({ ok: true });
  });

  it("returns null for a matching error frame", () => {
    expect(
      findResponseFrame(['{"id":4,"error":{"code":-32600,"message":"bad"}}'], 4),
    ).toBeNull();
  });

  it("returns null when no frame matches", () => {
    expect(findResponseFrame(CODEX_FRAMES_NO_RESPONSE, 2)).toBeNull();
  });
});

describe("parseCodexLiveQuota — pinned fixture frames", () => {
  it("parses the multi-bucket live shape, codex bucket first", () => {
    const parsed = parseCodexLiveQuota(CODEX_FRAMES_OK, 2, 3)!;
    expect(parsed.quota).toEqual({
      planType: "prolite",
      buckets: [
        {
          limitId: "codex",
          limitName: null,
          usedPercent: 6,
          windowDurationMins: 10080,
          resetsAtUnix: 1787671089,
          secondary: null, // single-window account: secondary CAN be null
        },
        {
          limitId: "codex_bengalfox",
          limitName: "GPT-5.3-Codex-Spark",
          usedPercent: 2,
          windowDurationMins: 10080,
          resetsAtUnix: 1787671089,
          secondary: null,
        },
      ],
      credits: { hasCredits: false, unlimited: false, balance: "0" },
      dailyUsage: [
        { date: "2026-08-15", tokens: 26808416 },
        { date: "2026-08-16", tokens: 69212904 },
        { date: "2026-08-17", tokens: 41972937 },
        { date: "2026-08-18", tokens: 20928692 },
      ],
      lifetimeTokens: 1383498631,
    });
  });

  it("keeps resetsAt as unix SECONDS — never converted to ISO", () => {
    const parsed = parseCodexLiveQuota(CODEX_FRAMES_OK, 2, 3)!;
    expect(parsed.quota.buckets[0].resetsAtUnix).toBe(1787671089);
    expect(typeof parsed.quota.buckets[0].resetsAtUnix).toBe("number");
  });

  it("round-trips the whole rateLimits result as rawRateLimitsJson", () => {
    const parsed = parseCodexLiveQuota(CODEX_FRAMES_OK, 2, 3)!;
    expect(JSON.parse(parsed.rawRateLimitsJson)).toEqual(
      JSON.parse(CODEX_FRAMES_OK[2]).result,
    );
  });

  it("falls back to top-level rateLimits on the historical dual-window shape", () => {
    const parsed = parseCodexLiveQuota(CODEX_FRAMES_DUAL_WINDOW, 2, 3)!;
    expect(parsed.quota.planType).toBe("plus");
    expect(parsed.quota.buckets).toEqual([
      {
        limitId: "codex",
        limitName: null,
        usedPercent: 1,
        windowDurationMins: 300,
        resetsAtUnix: 1778890682,
        secondary: {
          usedPercent: 0,
          windowDurationMins: 10080,
          resetsAtUnix: 1779477482,
        },
      },
    ]);
    expect(parsed.quota.credits).toBeNull();
    expect(parsed.quota.dailyUsage).toEqual([
      { date: "2025-09-05", tokens: 627471 },
    ]);
    expect(parsed.quota.lifetimeTokens).toBe(627471);
  });

  it("returns null when the rateLimits read was never answered", () => {
    expect(parseCodexLiveQuota(CODEX_FRAMES_NO_RESPONSE, 2, 3)).toBeNull();
  });

  it("tolerates a missing usage read — rate limits alone are still worth showing", () => {
    const lines = [CODEX_FRAMES_OK[0], CODEX_FRAMES_OK[2]]; // no id-3 frame
    const parsed = parseCodexLiveQuota(lines, 2, 3)!;
    expect(parsed.quota.buckets).toHaveLength(2);
    expect(parsed.quota.dailyUsage).toEqual([]);
    expect(parsed.quota.lifetimeTokens).toBeNull();
  });

  it("keeps object-key order when the map has no 'codex' bucket", () => {
    const lines = [
      '{"id":2,"result":{"rateLimits":{"planType":"pro"},"rateLimitsByLimitId":{"zeta":{"limitId":"zeta","primary":{"usedPercent":9}},"alpha":{"limitId":"alpha","primary":{"usedPercent":3}}}}}',
    ];
    const parsed = parseCodexLiveQuota(lines, 2, 3)!;
    expect(parsed.quota.buckets.map((bucket) => bucket.limitId)).toEqual([
      "zeta",
      "alpha",
    ]);
  });

  it("drops buckets without a string limitId or finite primary.usedPercent", () => {
    const lines = [
      '{"id":2,"result":{"rateLimits":{"planType":"pro"},"rateLimitsByLimitId":{"codex":{"limitId":"codex","primary":{"usedPercent":5}},"bad1":{"primary":{"usedPercent":5}},"bad2":{"limitId":"bad2","primary":{"usedPercent":"NaN"}}}}}',
    ];
    const parsed = parseCodexLiveQuota(lines, 2, 3)!;
    expect(parsed.quota.buckets.map((bucket) => bucket.limitId)).toEqual([
      "codex",
    ]);
  });

  it("returns null + one dev-log line when no bucket survives at all", () => {
    const lines = ['{"id":2,"result":{"rateLimits":{"planType":"pro"}}}'];
    expect(parseCodexLiveQuota(lines, 2, 3)).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("never throws on arbitrary garbage frames", () => {
    expect(() => parseCodexLiveQuota(["{", "null", "[]", '"x"'], 2, 3)).not.toThrow();
    expect(parseCodexLiveQuota(["{", "null", "[]", '"x"'], 2, 3)).toBeNull();
  });
});

describe("fetchCodexLiveQuota — injectable runner seam", () => {
  it("passes the pinned argv/timeout and parses the collected frames", async () => {
    const runner: AppServerRunner = vi.fn(async (argv, timeoutMs) => {
      expect([...argv]).toEqual(["codex", "app-server"]);
      expect(timeoutMs).toBe(APPSERVER_TIMEOUT_MS);
      return CODEX_FRAMES_OK;
    });
    const result = await fetchCodexLiveQuota(runner);
    expect(result?.quota.planType).toBe("prolite");
    expect(result?.quota.buckets[0].limitId).toBe("codex");
  });

  it("resolves null when the runner resolves null (timeout/ENOENT path)", async () => {
    expect(await fetchCodexLiveQuota(async () => null)).toBeNull();
  });

  it("resolves null (never throws) when the runner rejects", async () => {
    await expect(
      fetchCodexLiveQuota(async () => {
        throw new Error("spawn exploded");
      }),
    ).resolves.toBeNull();
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

function writtenFrames(child: FakeChildProc): unknown[] {
  return child.stdin.write.mock.calls.map((call) =>
    JSON.parse(String(call[0]).trim()),
  );
}

describe("runCodexAppServerProbe — handshake semantics against a fake child_process", () => {
  it("waits for the initialize response before initialized + reads, keeping stdin open", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const promise = runCodexAppServerProbe(CODEX_APPSERVER_ARGV, 10_000);

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["app-server"],
      expect.objectContaining({ shell: false, stdio: ["pipe", "pipe", "ignore"] }),
    );
    // Only the initialize request may be written before its response arrives.
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
    expect(writtenFrames(child)[0]).toMatchObject({ id: 1, method: "initialize" });
    expect(child.stdin.end).not.toHaveBeenCalled();

    child.stdout.emit("data", Buffer.from(CODEX_FRAMES_OK[0] + "\n"));

    // Handshake step 2: initialized notification + both reads. stdin must
    // STAY OPEN — codex app-server treats EOF as a client disconnect and
    // shuts down before answering (live-verified 2026-08-18); SIGKILL on
    // settle is the teardown path.
    expect(writtenFrames(child).slice(1)).toEqual([
      { jsonrpc: "2.0", method: "initialized" },
      { jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} },
      { jsonrpc: "2.0", id: 3, method: "account/usage/read", params: {} },
    ]);
    expect(child.stdin.end).not.toHaveBeenCalled();
    expect(child.unref).toHaveBeenCalled();

    // Interleaved notification + both responses -> resolve all lines + SIGKILL.
    child.stdout.emit(
      "data",
      Buffer.from(CODEX_FRAMES_OK.slice(1).join("\n") + "\n"),
    );
    const lines = await promise;
    expect(lines).toEqual(CODEX_FRAMES_OK);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("handles responses split across chunk boundaries", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const promise = runCodexAppServerProbe(CODEX_APPSERVER_ARGV, 10_000);
    const all = CODEX_FRAMES_OK.join("\n") + "\n";
    const mid = Math.floor(all.length / 2);
    child.stdout.emit("data", Buffer.from(all.slice(0, mid)));
    child.stdout.emit("data", Buffer.from(all.slice(mid)));

    expect(await promise).toEqual(CODEX_FRAMES_OK);
  });

  it("resolves null on the hard timeout when the reads never answer", async () => {
    vi.useFakeTimers();
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const promise = runCodexAppServerProbe(CODEX_APPSERVER_ARGV, 10_000);
    child.stdout.emit("data", Buffer.from(CODEX_FRAMES_NO_RESPONSE[0] + "\n"));
    vi.advanceTimersByTime(10_001);

    expect(await promise).toBeNull();
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("resolves null when the binary is missing (spawn error event)", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const promise = runCodexAppServerProbe(CODEX_APPSERVER_ARGV, 10_000);
    child.emit("error", Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    expect(await promise).toBeNull();
  });

  it("resolves null when the server exits before both reads answered", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child as never);

    const promise = runCodexAppServerProbe(CODEX_APPSERVER_ARGV, 10_000);
    child.stdout.emit("data", Buffer.from(CODEX_FRAMES_OK[0] + "\n"));
    child.stdout.emit("data", Buffer.from(CODEX_FRAMES_OK[2] + "\n")); // id 2 only
    child.emit("close", 0);
    expect(await promise).toBeNull();
  });
});
