import { describe, it, expect } from "vitest";
import * as schema from "@/lib/db/schema";

describe("Schema: epics PR columns", () => {
  it("has prNumber column", () => {
    const col = schema.epics.prNumber;
    expect(col).toBeDefined();
    expect(col.name).toBe("pr_number");
  });

  it("has prUrl column", () => {
    const col = schema.epics.prUrl;
    expect(col).toBeDefined();
    expect(col.name).toBe("pr_url");
  });

  it("has prStatus column", () => {
    const col = schema.epics.prStatus;
    expect(col).toBeDefined();
    expect(col.name).toBe("pr_status");
  });
});

describe("Schema: projects githubOwnerRepo column", () => {
  it("has githubOwnerRepo column", () => {
    const col = schema.projects.githubOwnerRepo;
    expect(col).toBeDefined();
    expect(col.name).toBe("github_owner_repo");
  });
});

describe("Schema: pullRequests table", () => {
  it("has all required columns", () => {
    const cols = schema.pullRequests;
    expect(cols.id).toBeDefined();
    expect(cols.projectId).toBeDefined();
    expect(cols.epicId).toBeDefined();
    expect(cols.number).toBeDefined();
    expect(cols.title).toBeDefined();
    expect(cols.url).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.headBranch).toBeDefined();
    expect(cols.baseBranch).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });

  it("has correct column names", () => {
    expect(schema.pullRequests.number.name).toBe("number");
    expect(schema.pullRequests.url.name).toBe("url");
    expect(schema.pullRequests.headBranch.name).toBe("head_branch");
    expect(schema.pullRequests.baseBranch.name).toBe("base_branch");
  });
});

describe("Schema: gitSyncLog table", () => {
  it("has all required columns", () => {
    const cols = schema.gitSyncLog;
    expect(cols.id).toBeDefined();
    expect(cols.projectId).toBeDefined();
    expect(cols.operation).toBeDefined();
    expect(cols.branch).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.detail).toBeDefined();
    expect(cols.createdAt).toBeDefined();
  });
});

describe("Schema: PR-related exported types", () => {
  it("exports PullRequest type", () => {
    const pr: schema.PullRequest = {
      id: "pr-1",
      projectId: "proj-1",
      epicId: "epic-1",
      number: 42,
      title: "Add feature",
      url: "https://github.com/org/repo/pull/42",
      status: "open",
      headBranch: "feature/test",
      baseBranch: "main",
      createdAt: "2025-01-01",
      updatedAt: "2025-01-01",
    };
    expect(pr.number).toBe(42);
  });

  it("exports GitSyncLogEntry type", () => {
    const entry: schema.GitSyncLog = {
      id: "log-1",
      projectId: "proj-1",
      operation: "pr_create",
      branch: "feature/test",
      status: "success",
      detail: '{"prNumber": 42}',
      createdAt: "2025-01-01",
    };
    expect(entry.operation).toBe("pr_create");
  });
});
