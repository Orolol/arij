/**
 * Tests for schema changes: releases GitHub fields, projects githubOwnerRepo,
 * and the gitSyncLog table.
 */
import { describe, it, expect } from "vitest";
import * as schema from "@/lib/db/schema";

describe("Schema: releases GitHub columns", () => {
  it("has githubReleaseId column", () => {
    const col = schema.releases.githubReleaseId;
    expect(col).toBeDefined();
    expect(col.name).toBe("github_release_id");
  });

  it("has githubReleaseUrl column", () => {
    const col = schema.releases.githubReleaseUrl;
    expect(col).toBeDefined();
    expect(col.name).toBe("github_release_url");
  });

  it("has pushedAt column", () => {
    const col = schema.releases.pushedAt;
    expect(col).toBeDefined();
    expect(col.name).toBe("pushed_at");
  });

  it("preserves existing release columns", () => {
    const cols = schema.releases;
    expect(cols.id).toBeDefined();
    expect(cols.projectId).toBeDefined();
    expect(cols.version).toBeDefined();
    expect(cols.title).toBeDefined();
    expect(cols.changelog).toBeDefined();
    expect(cols.epicIds).toBeDefined();
    expect(cols.gitTag).toBeDefined();
    expect(cols.createdAt).toBeDefined();
  });
});

describe("Schema: projects githubOwnerRepo column", () => {
  it("has githubOwnerRepo column", () => {
    const col = schema.projects.githubOwnerRepo;
    expect(col).toBeDefined();
    expect(col.name).toBe("github_owner_repo");
  });

  it("preserves existing project columns", () => {
    const cols = schema.projects;
    expect(cols.id).toBeDefined();
    expect(cols.name).toBeDefined();
    expect(cols.description).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.gitRepoPath).toBeDefined();
    expect(cols.spec).toBeDefined();
    expect(cols.imported).toBeDefined();
    expect(cols.createdAt).toBeDefined();
    expect(cols.updatedAt).toBeDefined();
  });
});

describe("Schema: gitSyncLog table", () => {
  it("has required columns", () => {
    const cols = schema.gitSyncLog;
    expect(cols.id).toBeDefined();
    expect(cols.projectId).toBeDefined();
    expect(cols.operation).toBeDefined();
    expect(cols.branch).toBeDefined();
    expect(cols.status).toBeDefined();
    expect(cols.detail).toBeDefined();
    expect(cols.createdAt).toBeDefined();
  });

  it("has correct column names", () => {
    expect(schema.gitSyncLog.id.name).toBe("id");
    expect(schema.gitSyncLog.projectId.name).toBe("project_id");
    expect(schema.gitSyncLog.operation.name).toBe("operation");
    expect(schema.gitSyncLog.branch.name).toBe("branch");
    expect(schema.gitSyncLog.status.name).toBe("status");
    expect(schema.gitSyncLog.detail.name).toBe("detail");
    expect(schema.gitSyncLog.createdAt.name).toBe("created_at");
  });
});

describe("Schema: exported types", () => {
  it("exports Release types", () => {
    const release: schema.Release = {
      id: "rel_1",
      projectId: "proj_1",
      version: "1.0.0",
      title: "Test",
      changelog: "Changes",
      epicIds: "[]",
      gitTag: "v1.0.0",
      githubReleaseId: 12345,
      githubReleaseUrl: "https://github.com/owner/repo/releases/1",
      pushedAt: "2025-01-01T00:00:00.000Z",
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    expect(release.githubReleaseId).toBe(12345);
  });

  it("exports GitSyncLog types", () => {
    const log: schema.GitSyncLog = {
      id: "log_1",
      projectId: "proj_1",
      operation: "tag_push",
      branch: null,
      status: "success",
      detail: null,
      createdAt: "2025-01-01T00:00:00.000Z",
    };
    expect(log.operation).toBe("tag_push");
  });
});
