/**
 * Tests that the reviewComments schema table is defined correctly.
 */
import { describe, it, expect } from "vitest";
import * as schema from "@/lib/db/schema";

describe("reviewComments schema", () => {
  it("exports the reviewComments table", () => {
    expect(schema.reviewComments).toBeDefined();
  });

  it("has expected columns", () => {
    const cols = Object.keys(schema.reviewComments);
    expect(cols).toContain("id");
    expect(cols).toContain("epicId");
    expect(cols).toContain("filePath");
    expect(cols).toContain("lineNumber");
    expect(cols).toContain("body");
    expect(cols).toContain("author");
    expect(cols).toContain("status");
    expect(cols).toContain("createdAt");
    expect(cols).toContain("updatedAt");
  });

  it("exports type aliases", () => {
    // Type-level check — if this compiles, the types exist
    const _rc: schema.ReviewComment | undefined = undefined;
    const _nrc: schema.NewReviewComment | undefined = undefined;
    expect(_rc).toBeUndefined();
    expect(_nrc).toBeUndefined();
  });
});
