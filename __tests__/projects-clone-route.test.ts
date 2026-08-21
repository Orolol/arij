import { describe, it, expect } from "vitest";
import { cloneProjectSchema } from "@/lib/validation/schemas";

/**
 * Request-body contract of POST /api/projects/clone.
 *
 * The route's behavior (clone service dispatch, conflict handling, audit
 * trail) is pinned in clone-lifecycle-clone-route.test.ts; this file pins the
 * validation schema alone, which is why it needs no route or git mocks.
 *
 * History: the "parsing et validation des URL GitHub" epic shipped the schema
 * with a speculative `branch` field for its clone-service stub. The real
 * service (clone-lifecycle epic) clones the default branch and records it, so
 * `branch` died with the stub; `projectId` (audit attribution on re-clone)
 * replaced it when the two epics merged.
 */
describe("cloneProjectSchema", () => {
  it("accepts a url alone", () => {
    const result = cloneProjectSchema.safeParse({
      url: "https://github.com/octocat/hello-world",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional projectId for re-clone attribution", () => {
    const result = cloneProjectSchema.safeParse({
      url: "octocat/hello-world",
      projectId: "proj_123",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.projectId).toBe("proj_123");
  });

  it("accepts an explicit null projectId (first-time clone)", () => {
    const result = cloneProjectSchema.safeParse({
      url: "octocat/hello-world",
      projectId: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing url", () => {
    expect(cloneProjectSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty url", () => {
    expect(cloneProjectSchema.safeParse({ url: "" }).success).toBe(false);
  });

  it("rejects a non-string url", () => {
    expect(cloneProjectSchema.safeParse({ url: 42 }).success).toBe(false);
  });

  it("rejects a url over 500 chars", () => {
    const url = `https://github.com/octocat/${"a".repeat(500)}`;
    expect(cloneProjectSchema.safeParse({ url }).success).toBe(false);
  });

  it("rejects a projectId over 64 chars", () => {
    const result = cloneProjectSchema.safeParse({
      url: "octocat/hello-world",
      projectId: "p".repeat(65),
    });
    expect(result.success).toBe(false);
  });
});
