import { describe, it, expect } from "vitest";
import { generateId, generatePrefixedId } from "../id";

describe("generateId", () => {
  it("generates an ID with the default length of 21", () => {
    const id = generateId();
    expect(id).toHaveLength(21);
  });

  it("generates an ID with a custom length", () => {
    const id = generateId(10);
    expect(id).toHaveLength(10);
  });

  it("generates only alphanumeric characters", () => {
    const id = generateId(100);
    expect(id).toMatch(/^[A-Za-z0-9]+$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("generatePrefixedId", () => {
  it("generates an ID with the given prefix", () => {
    const id = generatePrefixedId("epic");
    expect(id).toMatch(/^epic_[A-Za-z0-9]{21}$/);
  });

  it("generates an ID with a custom length", () => {
    const id = generatePrefixedId("story", 10);
    expect(id).toMatch(/^story_[A-Za-z0-9]{10}$/);
  });
});
