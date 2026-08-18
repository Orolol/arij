import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dbMockState,
  resetDbMockState,
  mockJsonRequest,
} from "@/__tests__/helpers/db-mock";
import { createProjectSchema } from "@/lib/validation/schemas";

vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

const pathState = vi.hoisted(() => ({
  result: { valid: true, normalizedPath: "/normalized/path" } as
    | { valid: true; normalizedPath: string }
    | { valid: false; error: string },
}));

vi.mock("@/lib/validation/path", () => ({
  validatePath: vi.fn(async () => pathState.result),
}));

const BASE = { name: "Arij", description: "Orchestrator" };

describe("createProjectSchema", () => {
  it("accepts the clone metadata fields as optional", () => {
    const parsed = createProjectSchema.safeParse({
      ...BASE,
      gitRepoPath: "/projects/Orolol-arij",
      githubOwnerRepo: "Orolol/arij",
      cloneSource: "github",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      defaultBranch: "main",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.cloneSource).toBe("github");
    expect(parsed.success && parsed.data.defaultBranch).toBe("main");
  });

  it("still accepts a payload with none of them", () => {
    expect(createProjectSchema.safeParse(BASE).success).toBe(true);
  });

  it("rejects a clone source Arij cannot have produced", () => {
    const parsed = createProjectSchema.safeParse({
      ...BASE,
      cloneSource: "gitlab",
    });
    expect(parsed.success).toBe(false);
  });

  it("bounds the remote url and default branch", () => {
    expect(
      createProjectSchema.safeParse({ ...BASE, gitRemoteUrl: "x".repeat(1001) })
        .success
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({ ...BASE, defaultBranch: "x".repeat(256) })
        .success
    ).toBe(false);
  });
});

describe("POST /api/projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
    pathState.result = { valid: true, normalizedPath: "/normalized/path" };
  });

  async function post(body: unknown) {
    const { POST } = await import("@/app/api/projects/route");
    return POST(mockJsonRequest(body));
  }

  it("stores the normalised absolute path, not the raw input", async () => {
    pathState.result = {
      valid: true,
      normalizedPath: "/home/user/arij/projects/Orolol-arij",
    };
    dbMockState.getQueue = [{ id: "proj-1" }];

    const res = await post({ ...BASE, gitRepoPath: "  ./projects/Orolol-arij  " });

    expect(res.status).toBe(201);
    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({
        gitRepoPath: "/home/user/arij/projects/Orolol-arij",
      })
    );
  });

  it("persists the GitHub clone metadata so the project is connected on arrival", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];

    await post({
      ...BASE,
      gitRepoPath: "/home/user/arij/projects/Orolol-arij",
      githubOwnerRepo: "Orolol/arij",
      cloneSource: "github",
      gitRemoteUrl: "https://github.com/Orolol/arij.git",
      defaultBranch: "main",
    });

    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({
        githubOwnerRepo: "Orolol/arij",
        cloneSource: "github",
        gitRemoteUrl: "https://github.com/Orolol/arij.git",
        defaultBranch: "main",
      })
    );
  });

  it("leaves every clone column NULL for a user-supplied path", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];

    await post({ ...BASE, gitRepoPath: "/local/repo" });

    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({
        githubOwnerRepo: null,
        cloneSource: null,
        gitRemoteUrl: null,
        defaultBranch: null,
      })
    );
  });

  it("keeps gitRepoPath null when no path was supplied", async () => {
    dbMockState.getQueue = [{ id: "proj-1" }];

    await post(BASE);

    expect(dbMockState.insertCalls[0]).toEqual(
      expect.objectContaining({ gitRepoPath: null })
    );
  });

  it("rejects an unusable path with the validator's message", async () => {
    pathState.result = {
      valid: false,
      error: "Path does not exist or is not accessible",
    };

    const res = await post({ ...BASE, gitRepoPath: "/nope" });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("Path does not exist or is not accessible");
    expect(dbMockState.insertCalls).toHaveLength(0);
  });
});
