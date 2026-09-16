import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compareStoredTimestamps,
  latestActivityTimestamp,
  parseStoredTimestamp,
} from "@/lib/utils/timestamps";

const originalTimezone = process.env.TZ;

describe("stored session activity timestamps", () => {
  beforeAll(() => {
    // Prove SQLite CURRENT_TIMESTAMP values stay UTC even on a non-UTC host.
    process.env.TZ = "Europe/Paris";
  });

  afterAll(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it("compares SQLite timestamps as UTC", () => {
    expect(
      latestActivityTimestamp(
        "2026-02-12T22:30:00.000Z",
        "2026-02-12 23:00:00"
      )
    ).toBe("2026-02-12T23:00:00.000Z");
    expect(parseStoredTimestamp("2026-02-12 23:00:00")).toBe(
      Date.parse("2026-02-12T23:00:00.000Z")
    );
  });

  it("ignores invalid values while retaining valid activity", () => {
    expect(
      latestActivityTimestamp(
        "not-a-timestamp",
        "2026-02-12T22:30:00.000Z"
      )
    ).toBe("2026-02-12T22:30:00.000Z");
    expect(parseStoredTimestamp("not-a-timestamp")).toBeNull();
  });

  it("returns null when no valid activity exists", () => {
    expect(latestActivityTimestamp(null, undefined, "invalid")).toBeNull();
  });

  it("sorts mixed formats by instant and keeps unknown dates last in both directions", () => {
    const times = [null, "2026-02-12T22:30:00.000Z", "2026-02-12 23:00:00", "invalid"];
    expect([...times].sort((a, b) => compareStoredTimestamps(a, b))).toEqual([
      "2026-02-12T22:30:00.000Z", "2026-02-12 23:00:00", null, "invalid",
    ]);
    expect([...times].sort((a, b) => compareStoredTimestamps(a, b, "desc"))).toEqual([
      "2026-02-12 23:00:00", "2026-02-12T22:30:00.000Z", null, "invalid",
    ]);
    expect(compareStoredTimestamps("2026-02-12T23:00:00Z", "2026-02-13T01:00:00.000+02:00")).toBe(0);
  });
  it("also treats legacy T-separated zoneless timestamps as UTC", () => {
    expect(parseStoredTimestamp("2026-02-12T23:00:00.125")).toBe(Date.parse("2026-02-12T23:00:00.125Z"));
  });

});
