import { describe, it, expect, vi, beforeEach } from "vitest";
import { dbMockState, resetDbMockState } from "@/__tests__/helpers/db-mock";

// Real drizzle-orm + real @/lib/db/schema; the shared chain mock ignores
// column identity, so no fake column maps.
vi.mock("@/lib/db", async () => {
  const { dbModuleMock } = await import("@/__tests__/helpers/db-mock");
  return dbModuleMock();
});

import { validateResumeSession } from "@/lib/agent-sessions/validate-resume";

describe("validateResumeSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbMockState();
  });

  it("returns null when no resumeSessionId is provided", () => {
    const result = validateResumeSession({ resumeSessionId: undefined, epicId: "epic-1" });
    expect(result).toBeNull();
  });

  it("returns null when previous session is not found", () => {
    dbMockState.getQueue = [null];
    const result = validateResumeSession({ resumeSessionId: "sess-1", epicId: "epic-1" });
    expect(result).toBeNull();
  });

  it("returns null when previous session has no cliSessionId", () => {
    dbMockState.getQueue = [{ cliSessionId: null, claudeSessionId: null, epicId: "epic-1", userStoryId: null }];
    const result = validateResumeSession({ resumeSessionId: "sess-1", epicId: "epic-1" });
    expect(result).toBeNull();
  });

  it("returns cliSessionId when epicId matches (epic-scoped)", () => {
    dbMockState.getQueue = [{ cliSessionId: "cli-abc", claudeSessionId: null, epicId: "epic-1", userStoryId: null }];
    const result = validateResumeSession({ resumeSessionId: "sess-1", epicId: "epic-1" });
    expect(result).toEqual({ cliSessionId: "cli-abc" });
  });

  it("returns null when epicId does not match", () => {
    dbMockState.getQueue = [{ cliSessionId: "cli-abc", claudeSessionId: null, epicId: "epic-2", userStoryId: null }];
    const result = validateResumeSession({ resumeSessionId: "sess-1", epicId: "epic-1" });
    expect(result).toBeNull();
  });

  it("returns cliSessionId when userStoryId matches (story-scoped)", () => {
    dbMockState.getQueue = [{ cliSessionId: "cli-abc", claudeSessionId: null, epicId: "epic-1", userStoryId: "story-1" }];
    const result = validateResumeSession({ resumeSessionId: "sess-1", epicId: "epic-1", userStoryId: "story-1" });
    expect(result).toEqual({ cliSessionId: "cli-abc" });
  });

  it("returns null when userStoryId does not match", () => {
    dbMockState.getQueue = [{ cliSessionId: "cli-abc", claudeSessionId: null, epicId: "epic-1", userStoryId: "story-2" }];
    const result = validateResumeSession({ resumeSessionId: "sess-1", epicId: "epic-1", userStoryId: "story-1" });
    expect(result).toBeNull();
  });

  it("falls back to claudeSessionId when cliSessionId is null", () => {
    dbMockState.getQueue = [{ cliSessionId: null, claudeSessionId: "claude-xyz", epicId: "epic-1", userStoryId: null }];
    const result = validateResumeSession({ resumeSessionId: "sess-1", epicId: "epic-1" });
    expect(result).toEqual({ cliSessionId: "claude-xyz" });
  });
});
