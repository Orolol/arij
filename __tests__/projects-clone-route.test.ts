import { describe, it, expect } from "vitest";
import { cloneProjectSchema } from "@/lib/validation/schemas";
import { mockJsonRequest, mockNextRequest } from "@/__tests__/helpers/db-mock";

describe("cloneProjectSchema", () => {
  it("accepts a url alone", () => {
    const result = cloneProjectSchema.safeParse({
      url: "https://github.com/octocat/hello-world",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an optional branch", () => {
    const result = cloneProjectSchema.safeParse({
      url: "octocat/hello-world",
      branch: "develop",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.branch).toBe("develop");
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

  it("rejects a branch over 255 chars", () => {
    const result = cloneProjectSchema.safeParse({
      url: "octocat/hello-world",
      branch: "b".repeat(256),
    });
    expect(result.success).toBe(false);
  });
});

describe("POST /api/projects/clone", () => {
  async function post(body: unknown) {
    const { POST } = await import("@/app/api/projects/clone/route");
    const res = await POST(mockJsonRequest(body));
    return { res, json: await res.json() };
  }

  it("returns 400 with the standard { error } shape when url is missing", async () => {
    const { res, json } = await post({});
    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
    expect(json.details.url).toBeDefined();
  });

  it("returns 400 when url is empty", async () => {
    const { res, json } = await post({ url: "" });
    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
  });

  it("returns 400 for an over-length url without reaching the git layer", async () => {
    const { res, json } = await post({
      url: `https://github.com/octocat/${"a".repeat(500)}`,
    });
    expect(res.status).toBe(400);
    expect(json.error).toBe("Validation failed");
    // The parser never ran, so no owner/repo was resolved.
    expect(json.data).toBeUndefined();
  });

  it("returns 400 for invalid JSON", async () => {
    const { POST } = await import("@/app/api/projects/clone/route");
    const res = await POST(
      mockNextRequest({ method: "POST", body: "{not json" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invalid JSON body");
  });

  it("returns 400 for a non-GitHub host", async () => {
    const { res, json } = await post({
      url: "https://gitlab.com/octocat/hello-world",
    });
    expect(res.status).toBe(400);
    expect(json.error).toMatch(/valid GitHub repository/);
  });

  it("returns 400 for a traversal attempt", async () => {
    const { res } = await post({ url: "octocat/.." });
    expect(res.status).toBe(400);
  });

  it("resolves a valid url to a normalised clone target", async () => {
    const { json } = await post({
      url: "https://github.com/octocat/hello-world/tree/main",
    });
    expect(json.data).toMatchObject({
      owner: "octocat",
      repo: "hello-world",
      ownerRepo: "octocat/hello-world",
      cloneUrl: "https://github.com/octocat/hello-world.git",
    });
  });

  it("forwards the optional branch to the clone service", async () => {
    const { json } = await post({
      url: "octocat/hello-world",
      branch: "develop",
    });
    expect(json.data.branch).toBe("develop");
  });

  it("passes a null branch through when omitted", async () => {
    const { json } = await post({ url: "octocat/hello-world" });
    expect(json.data.branch).toBeNull();
  });
});
