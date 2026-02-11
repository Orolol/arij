import { describe, it, expect } from "vitest";
import {
  validateEpicTitle,
  validateStoryPoints,
  validateStatus,
} from "../validators";

describe("validateEpicTitle", () => {
  it("accepts a valid title", () => {
    const result = validateEpicTitle("Testing Infrastructure");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects an empty string", () => {
    const result = validateEpicTitle("");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Title is required");
  });

  it("rejects a whitespace-only string", () => {
    const result = validateEpicTitle("   ");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Title is required");
  });

  it("rejects a title shorter than 3 characters", () => {
    const result = validateEpicTitle("AB");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Title must be at least 3 characters");
  });

  it("rejects a title longer than 200 characters", () => {
    const result = validateEpicTitle("A".repeat(201));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Title must be at most 200 characters");
  });

  it("accepts a title with exactly 3 characters", () => {
    const result = validateEpicTitle("ABC");
    expect(result.valid).toBe(true);
  });

  it("accepts a title with exactly 200 characters", () => {
    const result = validateEpicTitle("A".repeat(200));
    expect(result.valid).toBe(true);
  });
});

describe("validateStoryPoints", () => {
  it("accepts valid story points", () => {
    const result = validateStoryPoints(5);
    expect(result.valid).toBe(true);
  });

  it("accepts undefined (optional field)", () => {
    const result = validateStoryPoints(undefined);
    expect(result.valid).toBe(true);
  });

  it("accepts null (optional field)", () => {
    const result = validateStoryPoints(null);
    expect(result.valid).toBe(true);
  });

  it("rejects non-integer values", () => {
    const result = validateStoryPoints(3.5);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Story points must be an integer");
  });

  it("rejects string values", () => {
    const result = validateStoryPoints("5");
    expect(result.valid).toBe(false);
  });

  it("rejects points below 1", () => {
    const result = validateStoryPoints(0);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Story points must be between 1 and 100");
  });

  it("rejects points above 100", () => {
    const result = validateStoryPoints(101);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Story points must be between 1 and 100");
  });

  it("accepts boundary values 1 and 100", () => {
    expect(validateStoryPoints(1).valid).toBe(true);
    expect(validateStoryPoints(100).valid).toBe(true);
  });
});

describe("validateStatus", () => {
  it.each(["backlog", "todo", "in-progress", "review", "done"])(
    "accepts valid status: %s",
    (status) => {
      const result = validateStatus(status);
      expect(result.valid).toBe(true);
    }
  );

  it("rejects invalid status", () => {
    const result = validateStatus("invalid");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid status "invalid"');
  });

  it("rejects empty string", () => {
    const result = validateStatus("");
    expect(result.valid).toBe(false);
  });
});
