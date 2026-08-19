import { describe, it, expect, vi, beforeEach } from "vitest";
import { cloneProjectSchema } from "@/lib/validation/schemas";
import { mockJsonRequest, mockNextRequest } from "@/__tests__/helpers/db-mock";
import {
  cloneGitHubRepo,
  CloneServiceUnavailableError,
  type CloneGitHubRepoResult,
} from "@/lib/git/clone";

// Only the service function is replaced: importOriginal keeps the real
// CloneServiceUnavailableError so the route's `instanceof` check still works.
vi.mock("@/lib/git/clone", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/git/clone")>();
  return { ...actual, cloneGitHubRepo: vi.fn() };
});

const cloneMock = vi.mocked(cloneGitHubRepo);

const CLONE_RESULT: CloneGitHubRepoResult = {
  path: "/tmp/arij/projects/octocat-hello-world",
  ownerRepo: "octocat/hello-world",
  remoteUrl: "https://github.com/octocat/hello-world.git",
  defaultBranch: "main",
  reused: false,
};

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
  beforeEach(() => {
    cloneMock.mockReset();
    cloneMock.mockResolvedValue(CLONE_RESULT);
  });

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
    // Rejected by the schema, so the git layer was never reached.
    expect(cloneMock).not.toHaveBeenCalled();
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
    expect(cloneMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a traversal attempt without calling the clone service", async () => {
    const { res } = await post({ url: "octocat/.." });
    expect(res.status).toBe(400);
    expect(cloneMock).not.toHaveBeenCalled();
  });

  it("calls the clone service with the normalised repo and returns its result", async () => {
    const { res, json } = await post({
      url: "https://github.com/octocat/hello-world/tree/main",
    });

    expect(res.status).toBe(200);
    expect(json.data).toEqual(CLONE_RESULT);
    expect(cloneMock).toHaveBeenCalledTimes(1);
    expect(cloneMock).toHaveBeenCalledWith({
      repo: {
        owner: "octocat",
        repo: "hello-world",
        ownerRepo: "octocat/hello-world",
        cloneUrl: "https://github.com/octocat/hello-world.git",
      },
      branch: null,
    });
  });

  it("forwards the optional branch to the clone service", async () => {
    await post({ url: "octocat/hello-world", branch: "develop" });

    expect(cloneMock).toHaveBeenCalledWith(
      expect.objectContaining({ branch: "develop" })
    );
  });

  it("forwards a null branch when omitted", async () => {
    await post({ url: "octocat/hello-world" });

    expect(cloneMock).toHaveBeenCalledWith(
      expect.objectContaining({ branch: null })
    );
  });

  it("returns 501 while the clone service is unimplemented", async () => {
    cloneMock.mockRejectedValue(
      new CloneServiceUnavailableError("Clone service is not available yet.")
    );

    const { res, json } = await post({ url: "octocat/hello-world" });
    expect(res.status).toBe(501);
    expect(json.error).toMatch(/not available yet/);
  });

  it("returns 500 without leaking a raw git error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    cloneMock.mockRejectedValue(
      new Error(
        "fatal: could not read Authorization: Basic c2VjcmV0OnRva2Vu from remote"
      )
    );

    const { res, json } = await post({ url: "octocat/hello-world" });
    expect(res.status).toBe(500);
    expect(json.error).not.toMatch(/Basic|Authorization/);
    errorSpy.mockRestore();
  });
});
