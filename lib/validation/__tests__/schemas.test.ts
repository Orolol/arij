import { describe, it, expect } from "vitest";
import {
  createProjectSchema,
  updateProjectSchema,
  importProjectSchema,
  createEpicSchema,
  updateEpicSchema,
  createStorySchema,
  updateStorySchema,
  updateStoryByIdSchema,
} from "../schemas";

describe("createProjectSchema", () => {
  it("accepts valid project with name only", () => {
    const result = createProjectSchema.safeParse({ name: "My Project" });
    expect(result.success).toBe(true);
  });

  it("accepts valid project with all fields", () => {
    const result = createProjectSchema.safeParse({
      name: "My Project",
      description: "A description",
      gitRepoPath: "/home/user/project",
      githubOwnerRepo: "owner/repo",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing name", () => {
    const result = createProjectSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = createProjectSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 200 chars", () => {
    const result = createProjectSchema.safeParse({ name: "A".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("allows null optional fields", () => {
    const result = createProjectSchema.safeParse({
      name: "Test",
      description: null,
      gitRepoPath: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("updateProjectSchema", () => {
  it("accepts empty object (all fields optional)", () => {
    const result = updateProjectSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid status", () => {
    const result = updateProjectSchema.safeParse({ status: "building" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = updateProjectSchema.safeParse({ status: "invalid" });
    expect(result.success).toBe(false);
  });

  it("accepts name update", () => {
    const result = updateProjectSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("rejects empty name when provided", () => {
    const result = updateProjectSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });
});

describe("importProjectSchema", () => {
  it("accepts valid path", () => {
    const result = importProjectSchema.safeParse({ path: "/home/user/project" });
    expect(result.success).toBe(true);
  });

  it("rejects missing path", () => {
    const result = importProjectSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty path", () => {
    const result = importProjectSchema.safeParse({ path: "" });
    expect(result.success).toBe(false);
  });
});

describe("createEpicSchema", () => {
  it("accepts valid epic with title only", () => {
    const result = createEpicSchema.safeParse({ title: "New Epic" });
    expect(result.success).toBe(true);
  });

  it("accepts epic with all fields", () => {
    const result = createEpicSchema.safeParse({
      title: "New Epic",
      description: "Description",
      priority: 2,
      status: "todo",
      type: "bug",
      branchName: "feature/epic-123",
      confidence: 0.85,
      evidence: "Evidence text",
      userStories: [{ title: "Story 1", description: "Desc" }],
      dependencies: [{ ticketId: "a", dependsOnTicketId: "b" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing title", () => {
    const result = createEpicSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty title", () => {
    const result = createEpicSchema.safeParse({ title: "" });
    expect(result.success).toBe(false);
  });

  it("rejects title exceeding 200 chars", () => {
    const result = createEpicSchema.safeParse({ title: "A".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid priority", () => {
    const result = createEpicSchema.safeParse({ title: "T", priority: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = createEpicSchema.safeParse({ title: "T", status: "invalid" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid type", () => {
    const result = createEpicSchema.safeParse({ title: "T", type: "task" });
    expect(result.success).toBe(false);
  });

  it("rejects confidence out of range", () => {
    const result = createEpicSchema.safeParse({ title: "T", confidence: 2.0 });
    expect(result.success).toBe(false);
  });
});

describe("updateEpicSchema", () => {
  it("accepts empty object", () => {
    const result = updateEpicSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid partial update", () => {
    const result = updateEpicSchema.safeParse({
      title: "Updated",
      status: "review",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid position", () => {
    const result = updateEpicSchema.safeParse({ position: -1 });
    expect(result.success).toBe(false);
  });
});

describe("createStorySchema", () => {
  it("accepts valid story", () => {
    const result = createStorySchema.safeParse({
      epicId: "epic-123",
      title: "User story title",
    });
    expect(result.success).toBe(true);
  });

  it("accepts story with all fields", () => {
    const result = createStorySchema.safeParse({
      epicId: "epic-123",
      title: "Title",
      description: "Desc",
      acceptanceCriteria: "AC",
      status: "todo",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing epicId", () => {
    const result = createStorySchema.safeParse({ title: "Title" });
    expect(result.success).toBe(false);
  });

  it("rejects missing title", () => {
    const result = createStorySchema.safeParse({ epicId: "epic-123" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid status", () => {
    const result = createStorySchema.safeParse({
      epicId: "e",
      title: "T",
      status: "backlog",
    });
    expect(result.success).toBe(false);
  });
});

describe("updateStorySchema", () => {
  it("accepts empty object", () => {
    const result = updateStorySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts valid partial update", () => {
    const result = updateStorySchema.safeParse({
      title: "Updated title",
      status: "done",
    });
    expect(result.success).toBe(true);
  });
});

describe("updateStoryByIdSchema", () => {
  it("requires id", () => {
    const result = updateStoryByIdSchema.safeParse({ title: "T" });
    expect(result.success).toBe(false);
  });

  it("accepts valid update with id", () => {
    const result = updateStoryByIdSchema.safeParse({
      id: "story-1",
      title: "Updated",
    });
    expect(result.success).toBe(true);
  });
});
