import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

describe("Schema: github issue import columns", () => {
  it("epics has GitHub issue reference columns", () => {
    expect(schema.epics.githubIssueNumber).toBeDefined();
    expect(schema.epics.githubIssueNumber.name).toBe("github_issue_number");
    expect(schema.epics.githubIssueUrl).toBeDefined();
    expect(schema.epics.githubIssueUrl.name).toBe("github_issue_url");
    expect(schema.epics.githubIssueState).toBeDefined();
    expect(schema.epics.githubIssueState.name).toBe("github_issue_state");
  });

  it("githubIssues table has required triage/import columns", () => {
    const cols = schema.githubIssues;
    expect(cols.id).toBeDefined();
    expect(cols.projectId).toBeDefined();
    expect(cols.issueNumber).toBeDefined();
    expect(cols.title).toBeDefined();
    expect(cols.labels).toBeDefined();
    expect(cols.milestone).toBeDefined();
    expect(cols.githubUrl).toBeDefined();
    expect(cols.importedEpicId).toBeDefined();
    expect(cols.importedAt).toBeDefined();
  });
});
