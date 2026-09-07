import { describe, expect, it } from "vitest";
import { withStableKeys } from "@/lib/utils/stable-list-keys";

const keysOf = (items: readonly string[]) =>
  withStableKeys(items, (s) => s).map((pair) => pair.key);

describe("withStableKeys", () => {
  it("pairs every item with a key, in order", () => {
    const keyed = withStableKeys(["a", "b", "c"], (s) => s);
    expect(keyed.map((pair) => pair.item)).toEqual(["a", "b", "c"]);
    expect(new Set(keyed.map((pair) => pair.key)).size).toBe(3);
  });

  it("keys distinct items by their content", () => {
    const keys = keysOf(["a", "b", "c"]);
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("keeps duplicate content unique with an ordinal, in order", () => {
    const keys = keysOf(["a", "a", "b", "a"]);
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[1]).not.toBe(keys[3]);
  });

  it("gives an item the same key wherever it sits in the list", () => {
    const before = keysOf(["x", "y", "z"]);
    const after = keysOf(["z", "x", "y"]);
    expect(after[1]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    expect(after[0]).toBe(before[2]);
  });

  it("does not let content that ends in an ordinal collide with a suffixed key", () => {
    const keys = keysOf(["a#1", "a", "a", "a1", "a0"]);
    expect(new Set(keys).size).toBe(5);
  });

  it("returns no pairs for an empty list", () => {
    expect(withStableKeys([], () => "never")).toEqual([]);
  });
});
