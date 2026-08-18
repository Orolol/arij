import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-utils";
import { providerUsageSnapshots } from "@/lib/db/schema";
import {
  extractLatestRateLimitSnapshot,
  parseRateLimitLine,
} from "@/lib/usage/codex-rate-limits";

// The scanner writes through Drizzle, so it runs against a real in-memory
// database with the full migration chain rather than a hand-rolled fake.
const testDb = vi.hoisted(() => ({
  instance: null as ReturnType<
    typeof import("@/lib/db/test-utils").createTestDb
  > | null,
}));

vi.mock("@/lib/db", () => ({
  get db() {
    if (!testDb.instance) throw new Error("test db not initialised");
    return testDb.instance.db;
  },
  get sqlite() {
    if (!testDb.instance) throw new Error("test db not initialised");
    return testDb.instance.sqlite;
  },
}));

// ---- Import the impure module AFTER mocks ----
import {
  findRecentRolloutFiles,
  refreshCodexUsageSnapshot,
} from "@/lib/usage/codex-snapshot";

// Verbatim shape of a real ~/.codex/sessions rollout event (probed on this
// machine); only the numbers are varied across fixtures.
function rateLimitLine(opts: {
  timestamp: string;
  primaryPercent?: number | null;
  secondaryPercent?: number | null;
  planType?: string | null;
  primaryResetsAt?: number;
}): string {
  return JSON.stringify({
    timestamp: opts.timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: null,
      rate_limits: {
        limit_id: "codex",
        limit_name: null,
        primary:
          opts.primaryPercent === null
            ? null
            : {
                used_percent: opts.primaryPercent ?? 6.0,
                window_minutes: 300,
                resets_at: opts.primaryResetsAt ?? 1781795185,
              },
        secondary:
          opts.secondaryPercent === null
            ? null
            : {
                used_percent: opts.secondaryPercent ?? 1.0,
                window_minutes: 10080,
                resets_at: 1782381985,
              },
        credits: null,
        plan_type: opts.planType === undefined ? "prolite" : opts.planType,
        rate_limit_reached_type: null,
      },
    },
  });
}

const OTHER_EVENT_LINE = JSON.stringify({
  timestamp: "2026-06-18T10:00:00.000Z",
  type: "event_msg",
  payload: { type: "agent_message", message: "hello" },
});

describe("parseRateLimitLine", () => {
  it("parses a real snapshot line into the pinned shape", () => {
    const snapshot = parseRateLimitLine(
      rateLimitLine({ timestamp: "2026-06-18T10:26:25.000Z" }),
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.capturedAt).toBe("2026-06-18T10:26:25.000Z");
    expect(snapshot!.planType).toBe("prolite");
    expect(snapshot!.primary).toEqual({
      usedPercent: 6.0,
      windowMinutes: 300,
      resetsAt: 1781795185,
    });
    expect(snapshot!.secondary).toEqual({
      usedPercent: 1.0,
      windowMinutes: 10080,
      resetsAt: 1782381985,
    });
  });

  it("keeps resets_at in unix SECONDS, never rescaled", () => {
    const snapshot = parseRateLimitLine(
      rateLimitLine({
        timestamp: "2026-06-18T10:26:25.000Z",
        primaryResetsAt: 1781795185,
      }),
    );
    // Milliseconds would be 13 digits — the parser must not multiply.
    expect(snapshot!.primary!.resetsAt).toBe(1781795185);
  });

  it("stores the whole rate_limits object as rawJson for forward-compat", () => {
    const snapshot = parseRateLimitLine(
      rateLimitLine({ timestamp: "2026-06-18T10:26:25.000Z" }),
    );
    const raw = JSON.parse(snapshot!.rawJson);
    expect(raw.limit_id).toBe("codex");
    expect(raw.credits).toBeNull();
    expect(raw.rate_limit_reached_type).toBeNull();
  });

  it("accepts rate_limits on payload types other than token_count", () => {
    const line = JSON.stringify({
      timestamp: "2026-06-18T10:26:25.000Z",
      type: "event_msg",
      payload: {
        type: "some_future_event",
        rate_limits: { primary: { used_percent: 12.5 } },
      },
    });
    const snapshot = parseRateLimitLine(line);
    expect(snapshot!.primary).toEqual({
      usedPercent: 12.5,
      windowMinutes: null,
      resetsAt: null,
    });
  });

  it("drops a window whose used_percent is absent or non-finite", () => {
    const line = JSON.stringify({
      timestamp: "2026-06-18T10:26:25.000Z",
      payload: {
        rate_limits: {
          primary: { window_minutes: 300, resets_at: 1781795185 },
          secondary: { used_percent: "4.0", window_minutes: 10080 },
        },
      },
    });
    const snapshot = parseRateLimitLine(line);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.primary).toBeNull();
    expect(snapshot!.secondary).toBeNull();
  });

  it("keeps a window with used_percent but degrades its unknown fields to null", () => {
    const line = JSON.stringify({
      timestamp: "2026-06-18T10:26:25.000Z",
      payload: { rate_limits: { primary: { used_percent: 6 } } },
    });
    const snapshot = parseRateLimitLine(line);
    expect(snapshot!.primary).toEqual({
      usedPercent: 6,
      windowMinutes: null,
      resetsAt: null,
    });
  });

  it("returns null for a null plan_type instead of the string 'null'", () => {
    const snapshot = parseRateLimitLine(
      rateLimitLine({ timestamp: "2026-06-18T10:26:25.000Z", planType: null }),
    );
    expect(snapshot!.planType).toBeNull();
  });

  it.each([
    ["malformed JSON", "{not json at all"],
    ["empty string", ""],
    ["whitespace", "   "],
    ["a JSON array", "[1,2,3]"],
    ["a bare JSON string", '"hello"'],
    ["a line without rate_limits", OTHER_EVENT_LINE],
    [
      "a line without a timestamp",
      JSON.stringify({ payload: { rate_limits: { primary: {} } } }),
    ],
    [
      "a non-object rate_limits",
      JSON.stringify({ timestamp: "2026-06-18T10:00:00Z", payload: { rate_limits: 5 } }),
    ],
    [
      "a null payload",
      JSON.stringify({ timestamp: "2026-06-18T10:00:00Z", payload: null }),
    ],
  ])("returns null for %s without throwing", (_label, line) => {
    expect(() => parseRateLimitLine(line)).not.toThrow();
    expect(parseRateLimitLine(line)).toBeNull();
  });
});

describe("extractLatestRateLimitSnapshot", () => {
  it("keeps the newest (last) snapshot when a file has several", () => {
    const content = [
      rateLimitLine({ timestamp: "2026-06-18T10:00:00.000Z", primaryPercent: 2 }),
      OTHER_EVENT_LINE,
      rateLimitLine({ timestamp: "2026-06-18T11:00:00.000Z", primaryPercent: 5 }),
      OTHER_EVENT_LINE,
      rateLimitLine({ timestamp: "2026-06-18T12:00:00.000Z", primaryPercent: 9 }),
    ].join("\n");

    const snapshot = extractLatestRateLimitSnapshot(content);
    expect(snapshot!.capturedAt).toBe("2026-06-18T12:00:00.000Z");
    expect(snapshot!.primary!.usedPercent).toBe(9);
  });

  it("skips malformed trailing lines and falls back to the last valid one", () => {
    const content = [
      rateLimitLine({ timestamp: "2026-06-18T10:00:00.000Z", primaryPercent: 3 }),
      "{truncated write",
      "",
    ].join("\n");

    const snapshot = extractLatestRateLimitSnapshot(content);
    expect(snapshot!.capturedAt).toBe("2026-06-18T10:00:00.000Z");
    expect(snapshot!.primary!.usedPercent).toBe(3);
  });

  it("returns null when the file carries no rate_limits at all", () => {
    const content = [OTHER_EVENT_LINE, OTHER_EVENT_LINE].join("\n");
    expect(extractLatestRateLimitSnapshot(content)).toBeNull();
  });

  it("returns null for empty content", () => {
    expect(extractLatestRateLimitSnapshot("")).toBeNull();
  });

  it("handles CRLF line endings", () => {
    const content = [
      OTHER_EVENT_LINE,
      rateLimitLine({ timestamp: "2026-06-18T10:00:00.000Z" }),
    ].join("\r\n");
    expect(extractLatestRateLimitSnapshot(content)!.capturedAt).toBe(
      "2026-06-18T10:00:00.000Z",
    );
  });
});

// ---------------------------------------------------------------------------
// Filesystem scanner — a real temp ~/.codex/sessions-shaped tree, never the
// user's own. No codex process is ever spawned.
// ---------------------------------------------------------------------------

let root: string;

function writeRollout(
  relativeDay: string,
  name: string,
  content: string,
  mtimeSeconds?: number,
): string {
  const dir = path.join(root, relativeDay);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content, "utf8");
  if (mtimeSeconds !== undefined) {
    fs.utimesSync(filePath, mtimeSeconds, mtimeSeconds);
  }
  return filePath;
}

beforeEach(() => {
  testDb.instance = createTestDb();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "arij-codex-sessions-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function storedSnapshot() {
  return testDb.instance!.db.select().from(providerUsageSnapshots).all()[0];
}

describe("findRecentRolloutFiles", () => {
  it("returns rollout files newest-mtime first", () => {
    writeRollout(
      "2026/06/18",
      "rollout-2026-06-18T10-00-00-aaa.jsonl",
      "old",
      1_760_000_000,
    );
    writeRollout(
      "2026/06/18",
      "rollout-2026-06-18T12-00-00-bbb.jsonl",
      "new",
      1_770_000_000,
    );

    const files = findRecentRolloutFiles(root);
    expect(files).toHaveLength(2);
    expect(path.basename(files[0])).toBe("rollout-2026-06-18T12-00-00-bbb.jsonl");
  });

  it("ignores non-rollout files and directories that are not YYYY/MM/DD deep", () => {
    writeRollout("2026/06/18", "rollout-a.jsonl", "x");
    writeRollout("2026/06/18", "history.jsonl", "x");
    writeRollout("2026/06/18", "rollout-b.txt", "x");

    const files = findRecentRolloutFiles(root);
    expect(files.map((f) => path.basename(f))).toEqual(["rollout-a.jsonl"]);
  });

  it("caps the number of files considered", () => {
    for (let i = 0; i < 8; i++) {
      writeRollout("2026/06/18", `rollout-${i}.jsonl`, "x", 1_700_000_000 + i);
    }
    expect(findRecentRolloutFiles(root, 3)).toHaveLength(3);
  });

  it("only opens the 5 newest day directories", () => {
    // 7 days, newest last by name; only the 5 newest may contribute.
    for (const day of ["10", "11", "12", "13", "14", "15", "16"]) {
      writeRollout(`2026/06/${day}`, `rollout-${day}.jsonl`, "x");
    }
    const names = findRecentRolloutFiles(root, 50).map((f) => path.basename(f));
    expect(names).toHaveLength(5);
    expect(names.sort()).toEqual([
      "rollout-12.jsonl",
      "rollout-13.jsonl",
      "rollout-14.jsonl",
      "rollout-15.jsonl",
      "rollout-16.jsonl",
    ]);
  });

  it("returns an empty list for a missing root instead of throwing", () => {
    expect(() =>
      findRecentRolloutFiles(path.join(root, "does-not-exist")),
    ).not.toThrow();
    expect(findRecentRolloutFiles(path.join(root, "does-not-exist"))).toEqual([]);
  });
});

describe("refreshCodexUsageSnapshot", () => {
  it("stores the snapshot from the newest rollout file", () => {
    writeRollout(
      "2026/06/18",
      "rollout-old.jsonl",
      rateLimitLine({ timestamp: "2026-06-18T09:00:00.000Z", primaryPercent: 2 }),
      1_760_000_000,
    );
    const newest = writeRollout(
      "2026/06/18",
      "rollout-new.jsonl",
      rateLimitLine({ timestamp: "2026-06-18T18:00:00.000Z", primaryPercent: 6 }),
      1_770_000_000,
    );

    refreshCodexUsageSnapshot(root);

    const row = storedSnapshot();
    expect(row.provider).toBe("codex");
    expect(row.capturedAt).toBe("2026-06-18T18:00:00.000Z");
    expect(row.planType).toBe("prolite");
    expect(row.primaryUsedPercent).toBe(6);
    expect(row.primaryWindowMinutes).toBe(300);
    expect(row.primaryResetsAt).toBe(1781795185);
    expect(row.secondaryWindowMinutes).toBe(10080);
    expect(row.sourceFile).toBe(newest);
    expect(JSON.parse(row.rawJson).limit_id).toBe("codex");
  });

  it("falls through to an older file when the newest carries no rate_limits", () => {
    writeRollout(
      "2026/06/18",
      "rollout-quiet.jsonl",
      OTHER_EVENT_LINE,
      1_770_000_000,
    );
    writeRollout(
      "2026/06/18",
      "rollout-useful.jsonl",
      rateLimitLine({ timestamp: "2026-06-18T09:00:00.000Z", primaryPercent: 4 }),
      1_760_000_000,
    );

    refreshCodexUsageSnapshot(root);

    expect(storedSnapshot().primaryUsedPercent).toBe(4);
  });

  it("never overwrites a stored snapshot with an older captured_at", () => {
    writeRollout(
      "2026/06/18",
      "rollout-new.jsonl",
      rateLimitLine({ timestamp: "2026-06-18T18:00:00.000Z", primaryPercent: 9 }),
      1_770_000_000,
    );
    refreshCodexUsageSnapshot(root);
    expect(storedSnapshot().primaryUsedPercent).toBe(9);

    // A stale tree (e.g. a restored backup) must not roll the gauge back.
    fs.rmSync(root, { recursive: true, force: true });
    writeRollout(
      "2026/06/17",
      "rollout-stale.jsonl",
      rateLimitLine({ timestamp: "2026-06-17T08:00:00.000Z", primaryPercent: 1 }),
      1_755_000_000,
    );
    refreshCodexUsageSnapshot(root);

    const row = storedSnapshot();
    expect(row.capturedAt).toBe("2026-06-18T18:00:00.000Z");
    expect(row.primaryUsedPercent).toBe(9);
  });

  it("updates in place (single row per provider) when a newer snapshot appears", () => {
    writeRollout(
      "2026/06/18",
      "rollout-a.jsonl",
      rateLimitLine({ timestamp: "2026-06-18T09:00:00.000Z", primaryPercent: 2 }),
      1_760_000_000,
    );
    refreshCodexUsageSnapshot(root);

    fs.rmSync(root, { recursive: true, force: true });
    writeRollout(
      "2026/06/19",
      "rollout-b.jsonl",
      rateLimitLine({ timestamp: "2026-06-19T09:00:00.000Z", primaryPercent: 7 }),
      1_780_000_000,
    );
    refreshCodexUsageSnapshot(root);

    const rows = testDb.instance!.db.select().from(providerUsageSnapshots).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].capturedAt).toBe("2026-06-19T09:00:00.000Z");
    expect(rows[0].primaryUsedPercent).toBe(7);
  });

  it("writes nothing when no rollout file has a snapshot", () => {
    writeRollout("2026/06/18", "rollout-quiet.jsonl", OTHER_EVENT_LINE);
    refreshCodexUsageSnapshot(root);
    expect(testDb.instance!.db.select().from(providerUsageSnapshots).all()).toEqual(
      [],
    );
  });

  it("does not throw when ~/.codex/sessions does not exist", () => {
    expect(() =>
      refreshCodexUsageSnapshot(path.join(root, "nope")),
    ).not.toThrow();
    expect(testDb.instance!.db.select().from(providerUsageSnapshots).all()).toEqual(
      [],
    );
  });

  it("swallows and warns on a database failure instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeRollout(
      "2026/06/18",
      "rollout-a.jsonl",
      rateLimitLine({ timestamp: "2026-06-18T09:00:00.000Z" }),
    );
    testDb.instance!.sqlite.prepare("DROP TABLE provider_usage_snapshots").run();

    expect(() => refreshCodexUsageSnapshot(root)).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});
